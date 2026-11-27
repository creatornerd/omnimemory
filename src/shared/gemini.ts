import { AI_MODEL, CHAT_MODEL, type GeminiRequest } from '../core/ai';

/**
 * The only code that talks to Google's Gemini API (see core/ai.ts for what
 * is sent and why). Used from the extension's own pages, never from a
 * chatbot page, and only after the user turned on the AI assistant and
 * added their own key. The key goes in a header, never in the URL.
 */

export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
/** One request may take this long before it's given up and tried again. */
const TIMEOUT_MS = 30_000;
/** All tries together never take longer than this. */
const TOTAL_MS = 75_000;

export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    /** "limit": today's shared allowance is used up. */
    readonly code?: 'limit',
    /** Gemini's HTTP status, when it answered with an error. */
    readonly status?: number,
    /** How long Gemini asked us to wait before trying again. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

function explain(status: number, message: string, perDay = false): string {
  if (status === 400 && /api key/i.test(message)) return 'Gemini didn’t accept the API key. Check it in Settings → AI assistant.';
  if (status === 401 || status === 403) return 'Gemini didn’t accept the API key. Check it in Settings → AI assistant.';
  if (status === 429) {
    return perDay
      ? 'Gemini’s daily limit for this key is used up. Try again tomorrow.'
      : 'Gemini is busy right now. Try again in a minute.';
  }
  if (status === 404 || status >= 500) return 'Gemini didn’t answer just now. Try again in a minute.';
  return `Gemini returned an error (${status}).`;
}

/** Google's error details: which quota was hit, and how long it asks us to wait. */
interface ErrorBody {
  error?: {
    message?: string;
    details?: { quotaId?: string; violations?: { quotaId?: string }[]; retryDelay?: string }[];
  };
}

function quotaInfo(body: ErrorBody | null): { perDay: boolean; retryMs?: number } {
  const details = body?.error?.details ?? [];
  const ids = details.flatMap((detail) => [detail.quotaId, ...(detail.violations ?? []).map((v) => v.quotaId)]);
  const perDay = ids.some((id) => typeof id === 'string' && /PerDay/i.test(id));
  const delay = details.map((detail) => detail.retryDelay).find((value) => typeof value === 'string');
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  return { perDay, retryMs: Number.isFinite(seconds) ? seconds * 1000 : undefined };
}

/**
 * Waits before each retry. Gemini's free tier often answers "busy" (429) or,
 * for a moment, an empty "not found" (404) or "overloaded" (5xx); asking
 * again a little later usually works.
 */
const RETRY_AFTER_MS = [1200, 3500, 8000];
/** Never wait longer than this for one retry, whatever Google asks. */
const MAX_WAIT_MS = 12_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send one request; resolve to the JSON the model returned. Passing problems
 * (busy, overloaded, an empty "not found") are retried a few times.
 */
export async function generateJson(
  request: GeminiRequest,
  key: string,
  model: string = AI_MODEL,
  /** Shorter limits for quick automatic requests, which are better skipped than late. */
  limits: { timeoutMs?: number; totalMs?: number } = {},
): Promise<unknown> {
  if (!key) throw new AiError('Add your Gemini API key in Settings → AI assistant.');
  // Only the two models OmniMemory is built for.
  if (model !== AI_MODEL && model !== CHAT_MODEL) throw new AiError('Unknown model.');
  const timeoutMs = limits.timeoutMs ?? TIMEOUT_MS;
  const deadline = Date.now() + (limits.totalMs ?? TOTAL_MS);
  const left = () => deadline - Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await generateOnce(request, key, model, Math.min(timeoutMs, left()));
    } catch (error) {
      if (!(error instanceof AiError && error.retryable)) throw error;
      const pause = Math.min(MAX_WAIT_MS, Math.max(RETRY_AFTER_MS[attempt] ?? 0, error.retryAfterMs ?? 0));
      if (attempt >= RETRY_AFTER_MS.length || left() - pause < 5_000) {
        // Limits are per model, so the other one may still have room.
        const other = model === AI_MODEL ? CHAT_MODEL : AI_MODEL;
        if (left() < 3_000) throw error;
        try {
          return await generateOnce(request, key, other, Math.min(timeoutMs, left()));
        } catch {
          throw error;
        }
      }
      await wait(pause);
    }
  }
}

async function generateOnce(request: GeminiRequest, key: string, model: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${GEMINI_ORIGIN}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(request),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    // Both may be passing (a stalled request, a dropped connection), so try again.
    throw new AiError(
      controller.signal.aborted ? 'Gemini took too long to answer. Try again in a minute.' : 'Couldn’t reach Gemini. Check your connection.',
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json().catch(() => null)) as
    | (ErrorBody & {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
      })
    | null;
  if (!response.ok) {
    const { perDay, retryMs } = quotaInfo(body);
    // An empty 404 is Google's front door hiccuping, not a missing model.
    const passing = response.status >= 500 || (response.status === 429 && !perDay) || (response.status === 404 && !body?.error);
    throw new AiError(
      explain(response.status, body?.error?.message ?? '', perDay),
      passing,
      undefined,
      response.status,
      retryMs,
    );
  }
  if (body?.promptFeedback?.blockReason) throw new AiError('Gemini declined to answer this one.');

  const text = (body?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('Gemini sent an answer OmniMemory couldn’t read. Try again.');
  }
}

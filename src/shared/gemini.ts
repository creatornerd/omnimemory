import { AI_MODEL, CHAT_MODEL, type GeminiRequest } from '../core/ai';

/**
 * The only code that talks to Google's Gemini API (see core/ai.ts for what
 * is sent and why). Used from the extension's own pages, never from a
 * chatbot page, and only after the user turned on the AI assistant and
 * added their own key. The key goes in a header, never in the URL.
 */

export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
const TIMEOUT_MS = 60_000;

export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    /** "limit": today's shared allowance is used up. */
    readonly code?: 'limit',
    /** Gemini's HTTP status, when it answered with an error. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

function explain(status: number, message: string): string {
  if (status === 400 && /api key/i.test(message)) return 'Gemini didn’t accept the API key. Check it in Settings → AI assistant.';
  if (status === 401 || status === 403) return 'Gemini didn’t accept the API key. Check it in Settings → AI assistant.';
  if (status === 429) return 'Gemini’s limit for this key is used up for now. Try again in a minute.';
  if (status >= 500) return 'Gemini is having trouble right now. Try again in a minute.';
  return `Gemini returned an error (${status}).`;
}

const RETRY_AFTER_MS = [800, 2500];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send one request; resolve to the JSON the model returned. Gemini sometimes
 * answers "overloaded" (5xx) for a moment, so those are retried twice.
 */
export async function generateJson(request: GeminiRequest, key: string, model: string = AI_MODEL): Promise<unknown> {
  if (!key) throw new AiError('Add your Gemini API key in Settings → AI assistant.');
  // Only the two models OmniMemory is built for.
  if (model !== AI_MODEL && model !== CHAT_MODEL) throw new AiError('Unknown model.');
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await generateOnce(request, key, model);
    } catch (error) {
      if (!(error instanceof AiError && error.retryable) || attempt >= RETRY_AFTER_MS.length) throw error;
      await wait(RETRY_AFTER_MS[attempt]);
    }
  }
}

async function generateOnce(request: GeminiRequest, key: string, model: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
    throw new AiError(controller.signal.aborted ? 'Gemini took too long to answer.' : 'Couldn’t reach Gemini. Check your connection.');
  } finally {
    clearTimeout(timer);
  }

  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  } | null;
  if (!response.ok) {
    throw new AiError(explain(response.status, body?.error?.message ?? ''), response.status >= 500, undefined, response.status);
  }
  if (body?.promptFeedback?.blockReason) throw new AiError('Gemini declined to answer this one.');

  const text = (body?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('Gemini sent an answer OmniMemory couldn’t read. Try again.');
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_MODEL, CHAT_MODEL, type GeminiRequest } from '../src/core/ai';
import { AiError, generateJson } from '../src/shared/gemini';

const request: GeminiRequest = {
  systemInstruction: { parts: [{ text: 'x' }] },
  contents: [{ role: 'user', parts: [{ text: 'y' }] }],
  generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: {} },
};

const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
const emptyNotFound = () => new Response('', { status: 404 });
const busy = (quotaId: string, retryDelay = '2s') =>
  new Response(
    JSON.stringify({
      error: {
        message: 'You exceeded your current quota',
        details: [{ violations: [{ quotaId }] }, { retryDelay }],
      },
    }),
    { status: 429 },
  );

/** Answers in turn; records which model each request went to. */
function mockFetch(...answers: (() => Response)[]) {
  const models: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      models.push(String(url).match(/models\/([^:]+)/)?.[1] ?? '');
      const next = answers.shift();
      if (!next) throw new Error('no more answers');
      return next();
    }),
  );
  return models;
}

async function run(model = AI_MODEL) {
  vi.useFakeTimers();
  const pending = generateJson(request, 'test-key', model);
  const settled = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('talking to Gemini', () => {
  it('tries again after an empty "not found" from Google', async () => {
    const models = mockFetch(emptyNotFound, ok);
    expect(await run()).toEqual({ value: { ok: true } });
    expect(models).toEqual([AI_MODEL, AI_MODEL]);
  });

  it('waits out a per-minute limit, then uses the other model if needed', async () => {
    const perMinute = () => busy('GenerateRequestsPerMinutePerProjectPerModel-FreeTier');
    const models = mockFetch(perMinute, perMinute, perMinute, perMinute, ok);
    expect(await run()).toEqual({ value: { ok: true } });
    expect(models).toEqual([AI_MODEL, AI_MODEL, AI_MODEL, AI_MODEL, CHAT_MODEL]);
  });

  it('doesn’t keep asking once the daily limit is used up', async () => {
    const models = mockFetch(() => busy('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
    const result = (await run()) as { error: AiError };
    expect(result.error).toBeInstanceOf(AiError);
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toMatch(/daily limit/);
    expect(models).toHaveLength(1);
  });

  it('says plainly when Gemini keeps not answering', async () => {
    mockFetch(emptyNotFound, emptyNotFound, emptyNotFound, emptyNotFound, emptyNotFound);
    const result = (await run()) as { error: AiError };
    expect(result.error.message).toBe('Gemini didn’t answer just now. Try again in a minute.');
  });

  it('doesn’t retry a refused key', async () => {
    const models = mockFetch(() => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }));
    const result = (await run()) as { error: AiError };
    expect(result.error.message).toMatch(/didn’t accept the API key/);
    expect(models).toHaveLength(1);
  });
});

describe('when Gemini stalls', () => {
  it('gives up on a stuck request and asks again', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        calls += 1;
        if (calls > 1) return Promise.resolve(ok());
        return new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        );
      }),
    );
    expect(await run()).toEqual({ value: { ok: true } });
    expect(calls).toBe(2);
  });
});

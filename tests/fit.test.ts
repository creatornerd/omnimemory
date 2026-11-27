import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/background/router';
import {
  CONTEXT_FOOTER,
  CONTEXT_HEADER,
  MemoryAssistant,
  fitRequest,
  parseFit,
  withoutContext,
  type GeminiRequest,
  type GenerateOptions,
  type SiteId,
} from '../src/core';
import type { FitResult } from '../src/shared/messages';
import { createHarness } from './helpers';

/** The router with a pretend Gemini that picks memories by their text. */
function withModel(pick: (request: GeminiRequest) => unknown | Promise<unknown>) {
  const h = createHarness();
  const calls: { request: GeminiRequest; model?: string; options?: GenerateOptions }[] = [];
  const assistant = new MemoryAssistant(async (request, model, options) => {
    calls.push({ request, model, options });
    return pick(request);
  });
  async function fit(site: SiteId, draft: string, recent = ''): Promise<FitResult> {
    const response = await handleRequest({ type: 'context/fit', draft, recent }, site, {
      service: h.service,
      openDashboard: () => {},
      assistant: (settings) => (settings.aiEnabled ? assistant : null),
    });
    if (!response.ok) throw new Error(response.error);
    return response.data as FitResult;
  }
  return { ...h, calls, fit };
}

/** Index of the note containing `words` in the request's numbered list. */
function indexOf(request: GeminiRequest, words: string): number {
  const line = request.contents[0].parts[0].text.split('\n').find((l) => l.includes(words));
  return line ? Number(line.match(/^\[(\d+)\]/)?.[1]) : -1;
}

describe('memories that fit the message being typed', () => {
  it('asks Gemini with only what that chatbot may see, and remembers the answer', async () => {
    const h = withModel((request) => ({ indexes: [indexOf(request, 'vegetarian'), indexOf(request, 'peanuts')] }));
    await h.service.updateSettings({ aiEnabled: true });
    await h.service.create({ content: 'I am vegetarian.' });
    await h.service.create({ content: 'I am allergic to peanuts.' });
    await h.service.create({ content: 'I play the piano.' });
    await h.service.create({ content: 'My diary password hint is a secret', permissions: { chatgpt: false, claude: false, gemini: false } });
    await h.service.create({ content: 'I live in Austin.', permissions: { chatgpt: false } });

    const result = await h.fit('chatgpt', 'give me a dinner recipe for tonight');
    expect(result.by).toBe('ai');
    expect(result.items.map((m) => m.content)).toEqual(['I am vegetarian.', 'I am allergic to peanuts.']);
    const sent = h.calls[0].request.contents[0].parts[0].text;
    expect(sent).toContain('dinner recipe');
    expect(sent).not.toContain('diary'); // private
    expect(sent).not.toContain('Austin'); // not shared with ChatGPT
    // A quick automatic request on Flash Lite, not one of the daily actions.
    expect(h.calls[0].model).toBe('gemini-3.5-flash-lite');
    expect(h.calls[0].options).toEqual({ light: true });

    // The bar and the panel asking about the same words share one request.
    await h.fit('chatgpt', 'give me a dinner recipe for tonight');
    expect(h.calls).toHaveLength(1);
  });

  it('leaves out memories already added to the message', async () => {
    const h = withModel(() => ({ indexes: [] }));
    await h.service.updateSettings({ aiEnabled: true });
    await h.service.create({ content: 'I am vegetarian.' });
    const draft = `${CONTEXT_HEADER}\n- I am vegetarian.\n${CONTEXT_FOOTER}\nwhat should I cook`;
    await h.fit('chatgpt', draft);
    const sent = h.calls[0].request.contents[0].parts[0].text;
    expect(sent.split('NOTES')[0]).not.toContain('vegetarian');
    expect(sent).toContain('MESSAGE: what should I cook');
  });

  it('matches words on this device when the AI is off, busy, or turned off for suggestions', async () => {
    const h = withModel(() => {
      throw new Error('busy');
    });
    await h.service.create({ content: 'I build robots for a robotics club.' });
    await h.service.create({ content: 'I play the piano.' });

    const off = await h.fit('claude', 'help me design a robotics arm for the club');
    expect(off).toMatchObject({ by: 'words' });
    expect(off.items.map((m) => m.content)).toEqual(['I build robots for a robotics club.']);
    expect(h.calls).toHaveLength(0);

    await h.service.updateSettings({ aiEnabled: true });
    const busy = await h.fit('claude', 'help me design a robotics arm for the club');
    expect(busy.by).toBe('words');
    expect(busy.items).toHaveLength(1);
    expect(h.calls).toHaveLength(1);

    await h.service.updateSettings({ aiMatching: false });
    await h.fit('claude', 'help me design a robotics arm for the club, again');
    expect(h.calls).toHaveLength(1);
  });

  it('suggests nothing when reading the page is turned off', async () => {
    const h = withModel(() => ({ indexes: [0] }));
    await h.service.updateSettings({ aiEnabled: true, relevanceFromPage: false });
    await h.service.create({ content: 'I build robots for a robotics club.' });
    expect((await h.fit('chatgpt', 'robotics club robots')).items).toEqual([]);
    expect(h.calls).toHaveLength(0);
  });

  it('keeps only valid picks, at most four, without repeats', () => {
    const memories = ['a', 'b', 'c', 'd', 'e'].map((content) => ({ content }) as never);
    expect(parseFit({ indexes: [1, 1, 9, -1, 'x', 0, 2, 3, 4] }, memories)).toEqual([
      memories[1],
      memories[0],
      memories[2],
      memories[3],
    ]);
    expect(parseFit(null, memories)).toEqual([]);
  });

  it('never sends a line that looks like a credential', () => {
    const request = fitRequest('my key is sk-abcdefghijklmnopqrstuvwxyz123456. help me', '', []);
    expect(request.contents[0].parts[0].text).not.toContain('sk-abc');
    expect(request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
  });

  it('takes OmniMemory’s own blocks out of the text', () => {
    expect(withoutContext(`hi ${CONTEXT_HEADER}\n- x\n${CONTEXT_FOOTER} there`).replace(/\s+/g, ' ')).toBe('hi there');
    expect(withoutContext(`${CONTEXT_HEADER} unfinished`)).toBe('');
  });
});

describe('the shared key’s allowances', () => {
  it('counts automatic picks apart from the daily actions', async () => {
    const h = createHarness();
    await h.service.recordAiUse('picks');
    await h.service.recordAiUse('picks');
    expect((await h.service.getAiUsage('picks')).count).toBe(2);
    expect((await h.service.getAiUsage()).count).toBe(0);
  });
});

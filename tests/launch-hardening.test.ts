import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/background/router';
import {
  BLOCK_START,
  MemoryAssistant,
  aiCanRead,
  composeBlockField,
  parseBlock,
  safeBlockField,
} from '../src/core';
import { createHarness } from './helpers';

describe('AI privacy: only what the user would expect', () => {
  it('skips memories not shared with any chatbot, or switched off for AI', async () => {
    const h = createHarness();
    const shared = await h.service.create({ content: 'I prefer metric units' });
    const nowhere = await h.service.create({
      content: 'My blood type is O negative',
      permissions: { chatgpt: false, claude: false, gemini: false },
    });
    const noAi = await h.service.create({ content: 'I am planning a surprise party', aiAllowed: false });
    expect(aiCanRead(shared)).toBe(true);
    expect(nowhere.enabled).toBe(true);
    expect(aiCanRead(nowhere)).toBe(false);
    expect(aiCanRead(noAi)).toBe(false);

    // The switch can be changed later, and merging never widens it.
    const allowed = await h.service.update(noAi.id, { aiAllowed: true });
    expect(aiCanRead(allowed)).toBe(true);
    await h.service.update(noAi.id, { aiAllowed: false });
    const merged = await h.service.merge([shared.id, noAi.id], 'I prefer metric units and I am planning a party');
    expect(merged.aiAllowed).toBe(false);
  });
});

describe('free AI allowance', () => {
  it('counts actions per day and starts again the next day', async () => {
    const h = createHarness('2026-11-16T09:00:00');
    expect((await h.service.getAiUsage()).count).toBe(0);
    for (let i = 0; i < 3; i += 1) await h.service.recordAiUse();
    expect((await h.service.getAiUsage()).count).toBe(3);
    h.advanceDays(1);
    expect((await h.service.getAiUsage()).count).toBe(0);
  });
});

describe('sync never overwrites your own instructions', () => {
  const tricky = [
    'Be concise.\n\nAlso: use British spelling.',
    '  leading spaces and trailing  ',
    'Emoji 🎉 and “quotes” — and a dash',
    '[Not OmniMemory] brackets [/that]',
    'Line one\nLine two\n\n\nLine three',
  ];

  it.each(tricky)('keeps “%s” exactly as written through repeated syncs', (own) => {
    let field = own;
    for (const lines of [['I like tea'], ['I like tea', 'I live in Ohio'], [], ['I program VEX robots']]) {
      const next = safeBlockField(field, lines);
      expect(next).not.toBeNull();
      field = next as string;
      expect(parseBlock(field).outside).toBe(parseBlock(own).outside);
      expect(parseBlock(field).lines).toEqual(lines);
    }
  });

  it('leaves the field exactly as it was when the block is emptied', () => {
    const own = 'Keep answers short.';
    const withBlock = composeBlockField(own, ['I like tea']);
    expect(withBlock).toContain(BLOCK_START);
    expect(safeBlockField(withBlock, [])).toBe(own);
  });
});

describe('suggest from this chat', () => {
  it('is refused while the AI is off, and never repeats a memory you have (even a private one)', async () => {
    const h = createHarness();
    await h.service.create({ content: 'I program VEX robots using PROS and LemLib', enabled: false });
    const conversation = 'User: my VEX robot uses PROS and LemLib. Also I am in 10th grade. Assistant: Great!';

    const off = await handleRequest({ type: 'ai/suggest', conversation }, 'chatgpt', {
      service: h.service,
      openDashboard: () => {},
      assistant: () => null,
    });
    expect(off).toMatchObject({ ok: false, error: expect.stringMatching(/Turn on the AI assistant/) });

    let sent = '';
    const assistant = new MemoryAssistant(async (request) => {
      sent = request.contents[0].parts[0].text;
      return {
        notes: [
          { text: 'I program VEX robots using PROS and LemLib', category: 'Projects' },
          { text: 'I am in 10th grade', category: 'Education' },
        ],
        alreadyHave: 0,
      };
    });
    const on = await handleRequest({ type: 'ai/suggest', conversation }, 'chatgpt', {
      service: h.service,
      openDashboard: () => {},
      assistant: () => assistant,
    });
    expect(on).toEqual({ ok: true, data: { suggestions: [{ text: 'I am in 10th grade', category: 'Education' }], alreadyHave: 1 } });
    // The private memory itself was never sent to the AI.
    expect(sent).toContain('CONVERSATION');
    expect(sent.split('EXISTING')[1]).not.toContain('VEX');
  });

  it('drops parts of the chat that look like credentials before sending', async () => {
    let sent = '';
    const assistant = new MemoryAssistant(async (request) => {
      sent = request.contents[0].parts[0].text;
      return { notes: [], alreadyHave: 0 };
    });
    await assistant.suggestFromChat('I live in Ohio. My api_key is sk-abcdefghijklmnopqrstuvwxyz0123. I like tea.', []);
    expect(sent).toContain('I live in Ohio.');
    expect(sent).not.toContain('sk-abcdef');
  });
});

describe('secrets stay out of the repository', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }

  it('has no API keys in source, tests, docs or the manifest', () => {
    const keyLike = /AIza[0-9A-Za-z_-]{30,}|\bAQ\.[A-Za-z0-9_-]{30,}/;
    const scanned = [...files('src'), ...files('tests'), ...files('docs'), ...files('public'), 'README.md'].filter(
      (file) => /\.(ts|tsx|md|json|css|html)$/.test(file),
    );
    expect(scanned.filter((file) => keyLike.test(readFileSync(file, 'utf8')))).toEqual([]);
    expect(readFileSync('.gitignore', 'utf8')).toMatch(/^\.env\.\*$/m);
  });
});

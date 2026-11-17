import { describe, expect, it } from 'vitest';
import {
  MemoryAssistant,
  aiCanRead,
  buildExport,
  parseImportPlan,
  type FoundItem,
  type GeminiRequest,
} from '../src/core';
import { createHarness } from './helpers';

/** A pretend Gemini: records what it was sent and replies with `reply`. */
function fakeModel(reply: unknown) {
  const sent: GeminiRequest[] = [];
  const assistant = new MemoryAssistant(async (request) => {
    sent.push(request);
    return typeof reply === 'function' ? (reply as (r: GeminiRequest) => unknown)(request) : reply;
  });
  const text = () => sent.map((request) => request.contents[0].parts[0].text).join('\n');
  return { assistant, sent, text };
}

function found(texts: string[], site: FoundItem['site'] = 'chatgpt'): FoundItem[] {
  return texts.map((text, index) => ({ id: `${site}-${index}`, site, source: 'test', text, original: text }));
}

describe('AI assistant: what may be sent', () => {
  it('never sends private, deleted or credential-like memories', async () => {
    const h = createHarness();
    const shared = await h.service.create({ content: 'I prefer metric units' });
    const priv = await h.service.create({ content: 'My therapist is Dr. Lee', enabled: false });
    const secret = await h.service.create({ content: 'password: hunter2hunter2' });
    const gone = await h.service.create({ content: 'I used to live in Texas' });
    await h.service.remove([gone.id]);
    const all = await h.service.all();

    expect(aiCanRead(shared)).toBe(true);
    expect(aiCanRead(priv)).toBe(false);
    expect(aiCanRead(all.find((m) => m.id === secret.id)!)).toBe(false);
    expect(aiCanRead(all.find((m) => m.id === gone.id)!)).toBe(false);

    const model = fakeModel({ matches: [] });
    await model.assistant.checkRepeat('I use the metric system', all);
    expect(model.text()).toContain('I prefer metric units');
    expect(model.text()).not.toMatch(/therapist|hunter2|Texas/);
  });

  it('doesn’t call the model for a note that looks like a credential', async () => {
    const h = createHarness();
    const library = [await h.service.create({ content: 'I prefer metric units' })];
    const model = fakeModel({ matches: [] });
    expect(await model.assistant.checkRepeat('api_key=sk-abcdefghijklmnopqrstuvwxyz123456', library)).toEqual([]);
    expect(model.sent).toHaveLength(0);
  });

  it('keeps the API key out of settings and exports', async () => {
    const h = createHarness();
    await h.service.create({ content: 'I prefer metric units' });
    await expect(h.service.setAiKey('nope')).rejects.toThrow(/doesn’t look like/);
    await h.service.setAiKey('AQ.test-key-0123456789abcdef');
    expect(await h.service.getAiKey()).toBe('AQ.test-key-0123456789abcdef');
    expect(JSON.stringify(await h.service.getSettings())).not.toContain('test-key');
    expect(JSON.stringify(buildExport(await h.service.all()))).not.toContain('test-key');
    await h.service.setAiKey(null);
    expect(await h.service.getAiKey()).toBeNull();
  });
});

describe('AI assistant: repeats', () => {
  it('maps the model’s answer back to memories and ignores nonsense', async () => {
    const h = createHarness();
    const metric = await h.service.create({ content: 'I prefer metric units' });
    const imperial = await h.service.create({ content: 'I prefer imperial units' });
    const library = await h.service.library();
    // Candidates are sent newest first: [0] imperial, [1] metric.
    const model = fakeModel({
      matches: [
        { index: 1, kind: 'duplicate', reason: 'Same preference' },
        { index: 0, kind: 'conflict', reason: 'Opposite unit systems' },
        { index: 7, kind: 'duplicate', reason: 'out of range' },
        { index: 1, kind: 'conflict', reason: 'repeated index' },
        { index: 0, kind: 'related', reason: 'unknown kind' },
      ],
    });
    const matches = await model.assistant.checkRepeat('I use the metric system', library);
    expect(matches.map((m) => [m.memory.id, m.kind])).toEqual([
      [metric.id, 'duplicate'],
      [imperial.id, 'conflict'],
    ]);
  });

  it('skips the memory being edited', async () => {
    const h = createHarness();
    const a = await h.service.create({ content: 'I prefer metric units' });
    await h.service.create({ content: 'I live in Ohio' });
    const model = fakeModel({ matches: [] });
    await model.assistant.checkRepeat('I prefer the metric system', await h.service.library(), a.id);
    expect(model.text()).not.toContain('I prefer metric units');
  });

  it('finds groups in the library, one group per memory, with a safe merged wording', async () => {
    const h = createHarness();
    const a = await h.service.create({ content: 'I like tea' });
    const b = await h.service.create({ content: 'Tea is my favourite drink' });
    const c = await h.service.create({ content: 'I live in Ohio' });
    const d = await h.service.create({ content: 'I live in Texas' });
    const library = await h.service.library(); // newest first: d, c, b, a
    const model = fakeModel({
      groups: [
        { indexes: [2, 3], kind: 'duplicate', reason: 'Both about tea', merged: 'I like tea; it’s my favourite drink' },
        { indexes: [0, 1], kind: 'conflict', reason: 'Two different homes', merged: '' },
        { indexes: [3, 0], kind: 'duplicate', reason: 'already used', merged: 'x' },
        { indexes: [1, 1], kind: 'duplicate', reason: 'only one', merged: 'x' },
      ],
    });
    const groups = await model.assistant.scanLibrary(library);
    expect(groups).toHaveLength(2);
    expect(groups[0].memories.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(groups[0].merged).toBe('I like tea; it’s my favourite drink');
    expect(groups[1]).toMatchObject({ kind: 'conflict', merged: null });
    expect(groups[1].memories.map((m) => m.id).sort()).toEqual([c.id, d.id].sort());

    // A merged wording that looks like a secret falls back to the newest memory's text.
    const risky = fakeModel({
      groups: [{ indexes: [2, 3], kind: 'duplicate', reason: 'tea', merged: 'password: hunter2hunter2' }],
    });
    const [group] = await risky.assistant.scanLibrary(library);
    expect(group.merged).toBe('Tea is my favourite drink');
  });
});

describe('AI assistant: bringing in what chatbots remember', () => {
  it('combines finds, sets aside what you already have, and never hides anything', async () => {
    const h = createHarness();
    const metric = await h.service.create({ content: 'I prefer metric units' });
    const ohio = await h.service.create({ content: 'I live in Ohio' });
    const library = await h.service.library(); // newest first: ohio, metric
    const items = [
      ...found(['The user programs VEX robots.', 'User prefers the metric system.', 'User moved to Texas.']),
      ...found(['You build VEX robots with PROS.', 'Asked about pasta recipes once.'], 'gemini'),
    ];
    const model = fakeModel({
      notes: [
        { text: 'I program VEX robots using PROS', category: 'Projects', sources: [0, 3], existing: -1, conflict: -1 },
        { text: 'I prefer metric units', category: 'Preferences', sources: [1], existing: 1, conflict: -1 },
        { text: 'I live in Texas', category: 'Personal', sources: [2], existing: -1, conflict: 0, reason: 'You said Ohio' },
        { text: 'I like dogs', category: 'Pets', sources: [0], existing: -1, conflict: -1 },
      ],
      dropped: [4],
    });
    const plan = await model.assistant.planImport(items, library);

    expect(plan.suggestions).toHaveLength(2);
    expect(plan.suggestions[0]).toMatchObject({
      text: 'I program VEX robots using PROS',
      category: 'Projects',
      foundIds: ['chatgpt-0', 'gemini-0'],
    });
    expect(plan.suggestions[1].conflictsWith?.id).toBe(ohio.id);
    expect(plan.alreadyHave).toEqual([{ foundIds: ['chatgpt-1'], memory: expect.objectContaining({ id: metric.id }) }]);
    expect(plan.leftOut).toEqual(['gemini-1']);
  });

  it('puts anything the model forgot, or wrote as a secret, in “left out”', () => {
    const items = found(['A', 'B', 'C']);
    const plan = parseImportPlan(
      {
        notes: [
          { text: 'My api_key is sk-abcdefghijklmnopqrstuvwxyz0123', category: 'Other', sources: [0], existing: -1, conflict: -1 },
          { text: 'I like B', category: 'Nonsense', sources: [1, 9], existing: -1, conflict: -1 },
        ],
        dropped: [],
      },
      items,
      [],
    );
    expect(plan.suggestions).toEqual([{ text: 'I like B', category: 'Other', foundIds: ['chatgpt-1'] }]);
    expect(plan.leftOut.sort()).toEqual(['chatgpt-0', 'chatgpt-2']);
  });

  it('copes with a reply that isn’t the expected shape', () => {
    const plan = parseImportPlan('not json at all', found(['A', 'B']), []);
    expect(plan.suggestions).toEqual([]);
    expect(plan.leftOut).toEqual(['chatgpt-0', 'chatgpt-1']);
  });
});

describe('AI assistant: chat', () => {
  it('turns the reply into changes, touching each memory at most once', async () => {
    const h = createHarness();
    const a = await h.service.create({ content: 'I program VEX robots using PROS and LemLib' });
    const b = await h.service.create({ content: 'I’ve asked how to tune PID in LemLib' });
    const c = await h.service.create({ content: 'My VEX setup uses PROS with LemLib' });
    const priv = await h.service.create({ content: 'My diary password hint', enabled: false });
    const library = await h.service.library(); // newest first: priv(hidden), c, b, a
    let model = '';
    const assistant = new MemoryAssistant(async (request, m) => {
      model = m ?? '';
      expect(request.contents.at(-1)?.parts[0].text).not.toContain('diary');
      return {
        reply: 'I merged the robotics notes and removed a chat remark.',
        changes: [
          { action: 'edit', index: 2, text: 'I program VEX robots using PROS and LemLib.' },
          { action: 'delete', index: 1, text: '' },
          { action: 'delete', index: 0, text: '' },
          { action: 'delete', index: 0, text: '' },
          { action: 'edit', index: 9, text: 'out of range' },
          { action: 'add', index: -1, text: 'My api_key is sk-abcdefghijklmnopqrstuvwxyz0123', category: 'Other' },
          { action: 'add', index: -1, text: 'I compete in VEX V5', category: 'Projects' },
        ],
      };
    });
    const answer = await assistant.chat([{ role: 'user', text: 'Remove repeats' }], library);
    expect(model).toBe('gemini-3.5-flash');
    expect(answer.reply).toMatch(/merged/);
    expect(answer.changes.map((change) => change.kind)).toEqual(['edit', 'delete', 'delete', 'add']);
    expect(answer.changes[0]).toMatchObject({ kind: 'edit', memory: { id: a.id } });
    expect(answer.changes.slice(1, 3).map((change) => (change as { memory: { id: string } }).memory.id)).toEqual([b.id, c.id]);
    expect(answer.memories.some((memory) => memory.id === priv.id)).toBe(false);
  });

  it('falls back to Flash Lite when Flash is overloaded', async () => {
    const models: string[] = [];
    const assistant = new MemoryAssistant(async (_request, model) => {
      models.push(model ?? '');
      if (model === 'gemini-3.5-flash') throw Object.assign(new Error('busy'), { retryable: true });
      return { reply: 'Nothing to change.', changes: [] };
    });
    const answer = await assistant.chat([{ role: 'user', text: 'Hi' }], []);
    expect(models).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
    expect(answer.fellBack).toBe(true);
  });
});

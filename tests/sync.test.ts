import { describe, expect, it } from 'vitest';
import {
  BLOCK_END,
  BLOCK_START,
  blockLine,
  composeBlockField,
  parseBlock,
  readBlockField,
  repairContent,
  type OpResult,
  type RemoteSnapshot,
  type SyncOp,
} from '../src/core/sync';
import type { SiteId } from '../src/core/types';
import { parseBatchResponse } from '../src/content/sync/gemini';
import { parseSummaryStream } from '../src/content/sync/chatgpt';
import { parseRequest, parseRequestWithReason } from '../src/shared/messages';
import { createHarness } from './helpers';

type Harness = ReturnType<typeof createHarness>;

interface FakeRemote {
  snapshot(): RemoteSnapshot;
  apply(op: SyncOp): OpResult;
}

/** Behaves like Gemini's Instructions list, including adding a full stop. */
class FakeGemini implements FakeRemote {
  items = new Map<string, string>();
  private next = 0;
  calls: SyncOp['op'][] = [];

  add(text: string): string {
    const id = `g${(this.next += 1)}`;
    this.items.set(id, text);
    return id;
  }
  texts(): string[] {
    return [...this.items.values()];
  }
  snapshot(): RemoteSnapshot {
    return { managed: [...this.items].map(([id, text]) => ({ id, text })), readOnly: [] };
  }
  apply(op: SyncOp): OpResult {
    this.calls.push(op.op);
    const saved = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
    switch (op.op) {
      case 'create': {
        if (op.text.includes('REFUSE')) return { ok: false, error: 'Gemini can’t save this info.' };
        const id = this.add(saved(op.text));
        return { ok: true, remoteId: id, remoteText: this.items.get(id) };
      }
      case 'update':
        this.items.set(op.remoteId, saved(op.text));
        return { ok: true, remoteId: op.remoteId, remoteText: this.items.get(op.remoteId) };
      case 'delete':
        this.items.delete(op.remoteId);
        return { ok: true };
      default:
        return { ok: false, error: 'unsupported' };
    }
  }
}

/** Behaves like ChatGPT's "More about you" custom-instruction field. */
class FakeChatGpt implements FakeRemote {
  constructor(public field = '') {}
  snapshot(): RemoteSnapshot {
    // Same helper the real ChatGPT adapter uses.
    const { managed, blockBudget, needsRewrite } = readBlockField(this.field);
    return {
      managed,
      readOnly: [{ id: 'summary-overview', group: 'Memory summary (written by ChatGPT)', title: 'Overview', text: 'You build robots.' }],
      blockBudget,
      needsRewrite,
    };
  }
  apply(op: SyncOp): OpResult {
    if (op.op !== 'set-block') return { ok: false, error: 'unsupported' };
    this.field = composeBlockField(parseBlock(this.field).outside, op.lines.map((line) => line.text));
    return { ok: true };
  }
  lines(): string[] {
    return parseBlock(this.field).lines;
  }
}

/** One full sync, exactly as the content script on `site` performs it. */
async function sync(h: Harness, site: SiteId, remote: FakeRemote) {
  const begin = await h.ask(site, { type: 'sync/begin', remote: remote.snapshot() });
  if (begin.status !== 'ready') return { begin, ops: [] as SyncOp[] };
  const results = begin.ops.map((op) => remote.apply(op));
  await h.ask(site, { type: 'sync/commit', planId: begin.planId, results, after: remote.snapshot() });
  await h.ask(site, { type: 'sync/done' });
  return { begin, ops: begin.ops };
}

async function pending(h: Harness, site: SiteId) {
  return (await h.ask(site, { type: 'sync/status' })).pending;
}

describe('Gemini (list of entries)', () => {
  it('adds a new memory, then has nothing left to do', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    await h.service.create({ content: 'I program VEX robots using PROS and LemLib' });
    expect(await pending(h, 'gemini')).toBe(1);

    const first = await sync(h, 'gemini', gemini);
    expect(first.ops.map((op) => op.op)).toEqual(['create']);
    expect(gemini.texts()).toEqual(['I program VEX robots using PROS and LemLib.']);
    expect(await pending(h, 'gemini')).toBe(0);

    // Gemini's added full stop is not mistaken for an edit on either side.
    const second = await sync(h, 'gemini', gemini);
    expect(second.ops).toEqual([]);
    expect((await h.service.library())[0].content).toBe('I program VEX robots using PROS and LemLib');
    expect(h.finished).toEqual(['gemini', 'gemini']);
  });

  it('edits the same Gemini entry when the memory is edited', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    const memory = await h.service.create({ content: 'I use Python 3.11' });
    await sync(h, 'gemini', gemini);
    const [id] = gemini.items.keys();

    await h.service.update(memory.id, { content: 'I use Python 3.13' });
    const { ops } = await sync(h, 'gemini', gemini);
    expect(ops.map((op) => op.op)).toEqual(['update']);
    expect([...gemini.items]).toEqual([[id, 'I use Python 3.13.']]);
  });

  it('removes the entry when the memory is deleted, made private, outdated or unshared', async () => {
    for (const change of ['delete', 'private', 'outdated', 'unshare'] as const) {
      const h = createHarness();
      const gemini = new FakeGemini();
      const memory = await h.service.create({ content: 'My robot has a 4-motor drivetrain' });
      await sync(h, 'gemini', gemini);
      expect(gemini.items.size).toBe(1);

      if (change === 'delete') await h.service.remove([memory.id]);
      if (change === 'private') await h.service.update(memory.id, { enabled: false });
      if (change === 'outdated') await h.service.setOutdated([memory.id], true);
      if (change === 'unshare') await h.service.update(memory.id, { permissions: { gemini: false } });

      const { ops } = await sync(h, 'gemini', gemini);
      expect(ops.map((op) => op.op), change).toEqual(['delete']);
      expect(gemini.items.size, change).toBe(0);
    }
  });

  it('puts a restored memory back', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    const memory = await h.service.create({ content: 'I compete in VEX V5' });
    await sync(h, 'gemini', gemini);
    await h.service.remove([memory.id]);
    await sync(h, 'gemini', gemini);
    expect(gemini.items.size).toBe(0);

    await h.service.restore([memory.id]);
    await sync(h, 'gemini', gemini);
    expect(gemini.texts()).toEqual(['I compete in VEX V5.']);
  });

  it('brings edits made in Gemini back into OmniMemory', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    const memory = await h.service.create({ content: 'I live in Seattle' });
    await sync(h, 'gemini', gemini);
    const [id] = gemini.items.keys();

    gemini.items.set(id, 'I live in Portland.');
    const { ops } = await sync(h, 'gemini', gemini);
    expect(ops).toEqual([]);
    expect((await h.service.get(memory.id))?.content).toBe('I live in Portland.');
    // And nothing bounces back.
    expect((await sync(h, 'gemini', gemini)).ops).toEqual([]);
  });

  it('stops sharing a memory with Gemini when it is removed in Gemini', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    const memory = await h.service.create({ content: 'I like dark mode' });
    await sync(h, 'gemini', gemini);

    gemini.items.clear();
    const { ops } = await sync(h, 'gemini', gemini);
    expect(ops).toEqual([]);
    const after = await h.service.get(memory.id);
    expect(after?.permissions).toEqual({ chatgpt: true, claude: true, gemini: false });
    expect(after?.status).toBe('active');
    expect(await h.visibleTo('gemini')).toEqual([]);
    expect(await h.visibleTo('chatgpt')).toEqual(['I like dark mode']);
  });

  it('lists entries added in Gemini for review instead of importing them, and links same-meaning ones', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    await h.service.create({ content: 'I program VEX robots' });
    gemini.add('I program VEX robots.'); // already there, same meaning
    gemini.add('Use bullet points for long answers');

    const { ops } = await sync(h, 'gemini', gemini);
    expect(ops).toEqual([]);
    expect((await h.service.library()).map((m) => m.content)).toEqual(['I program VEX robots']);
    const found = await h.sync.allFound();
    expect(found.map((item) => item.text)).toEqual(['Use bullet points for long answers']);
    expect(gemini.items.size).toBe(2); // nothing removed from Gemini
  });

  it('never copies credentials in either direction', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    await h.service.create({ content: 'my api key is sk-abcdefghijklmnopqrstuvwxyz123456' });
    gemini.add('password: hunter2hunter2!');
    const { ops } = await sync(h, 'gemini', gemini);
    expect(ops).toEqual([]);
    expect((await h.service.library()).map((m) => m.content)).toEqual(['my api key is sk-abcdefghijklmnopqrstuvwxyz123456']);
  });

  it('writes nothing while sharing is paused or sync is off for Gemini', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    await h.service.create({ content: 'I like tea' });

    await h.service.updateSettings({ sharingPaused: true });
    expect(await h.ask('gemini', { type: 'sync/begin', remote: gemini.snapshot() })).toEqual({ status: 'skip', reason: 'paused' });

    await h.service.updateSettings({ sharingPaused: false, siteSync: { gemini: false } });
    expect(await h.ask('gemini', { type: 'sync/begin', remote: gemini.snapshot() })).toEqual({ status: 'skip', reason: 'off' });
    expect((await h.ask('gemini', { type: 'sync/status' })).blocked).toBe('off');
    expect(gemini.items.size).toBe(0);
  });

  it('does not keep retrying something Gemini refused', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    await h.service.create({ content: 'REFUSE this one' });
    await sync(h, 'gemini', gemini);
    const state = await h.sync.state('gemini');
    expect(state.lastError).toBe('Gemini can’t save this info.');
    expect(await pending(h, 'gemini')).toBe(0);
    expect((await sync(h, 'gemini', gemini)).ops).toEqual([]);

    h.advanceHours(7);
    expect(await pending(h, 'gemini')).toBe(1);
  });

  it('doesn’t treat an entry as removed in Gemini when the save didn’t return its id', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    const memory = await h.service.create({ content: 'I like tea' });
    const begin = await h.ask('gemini', { type: 'sync/begin', remote: gemini.snapshot() });
    if (begin.status !== 'ready') throw new Error('not ready');
    gemini.add('I like tea.');
    await h.ask('gemini', { type: 'sync/commit', planId: begin.planId, results: [{ ok: true }], after: gemini.snapshot() });

    expect((await sync(h, 'gemini', gemini)).ops).toEqual([]); // matched up by wording, no duplicate
    expect((await h.service.get(memory.id))?.permissions.gemini).toBe(true);
    expect((await h.sync.state('gemini')).links[0].remoteId).toBe('g1');
  });

  it('lets only one tab sync at a time', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    await h.service.create({ content: 'I like tea' });
    const first = await h.ask('gemini', { type: 'sync/begin', remote: gemini.snapshot() });
    const second = await h.ask('gemini', { type: 'sync/begin', remote: gemini.snapshot() });
    expect(first.status).toBe('ready');
    expect(second).toEqual({ status: 'busy' });

    const stale = await h.ask('gemini', { type: 'sync/commit', planId: 'plan-999', results: [], after: null });
    expect(stale.error).toMatch(/superseded/);
  });

  it('keeps each site to its own sync state', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    await h.service.create({ content: 'I like tea' });
    await sync(h, 'gemini', gemini);
    expect((await h.sync.state('gemini')).links).toHaveLength(1);
    expect((await h.sync.state('chatgpt')).links).toHaveLength(0);
  });
});

describe('ChatGPT (custom instructions block)', () => {
  it('writes shared memories into a marked block and leaves the user’s own text alone', async () => {
    const h = createHarness();
    const chatgpt = new FakeChatGpt('I am a high-school student.');
    await h.service.create({ content: 'I program VEX robots' });
    await h.service.create({ content: 'Private thing', enabled: false });
    await h.service.create({ content: 'Gemini only', permissions: { chatgpt: false } });

    await sync(h, 'chatgpt', chatgpt);
    expect(chatgpt.field).toBe(`I am a high-school student.\n\n${BLOCK_START}\n- I program VEX robots\n${BLOCK_END}`);
    expect(await pending(h, 'chatgpt')).toBe(0);
    expect((await sync(h, 'chatgpt', chatgpt)).ops).toEqual([]);

    // The dashboard sees what ChatGPT remembers, including its own summary.
    const snapshot = (await h.sync.state('chatgpt')).snapshot;
    expect(snapshot?.entries.map((e) => e.group)).toContain('Memory summary (written by ChatGPT)');
    expect(snapshot?.entries.find((e) => e.text === 'I program VEX robots')?.memoryId).toBeDefined();
  });

  it('updates and removes lines as memories change, and drops the block when empty', async () => {
    const h = createHarness();
    const chatgpt = new FakeChatGpt();
    const a = await h.service.create({ content: 'Line A' });
    await sync(h, 'chatgpt', chatgpt);
    await h.service.update(a.id, { content: 'Line A, edited' });
    await sync(h, 'chatgpt', chatgpt);
    expect(chatgpt.lines()).toEqual(['Line A, edited']);

    await h.service.remove([a.id]);
    await sync(h, 'chatgpt', chatgpt);
    expect(chatgpt.field).toBe('');
  });

  it('brings line edits, removals and additions made in ChatGPT back', async () => {
    const h = createHarness();
    const chatgpt = new FakeChatGpt();
    const tea = await h.service.create({ content: 'I like tea' });
    await sync(h, 'chatgpt', chatgpt);

    // Edit one line.
    chatgpt.field = composeBlockField('', ['I like green tea']);
    await sync(h, 'chatgpt', chatgpt);
    expect((await h.service.get(tea.id))?.content).toBe('I like green tea');

    // Remove it, and add another.
    chatgpt.field = composeBlockField('', ['I play the cello', 'I live in Ohio']);
    await sync(h, 'chatgpt', chatgpt);
    expect((await h.service.get(tea.id))?.permissions.chatgpt).toBe(false);
    const contents = (await h.service.library()).map((m) => m.content).sort();
    expect(contents).toEqual(['I like green tea', 'I live in Ohio', 'I play the cello']);
    expect(chatgpt.lines().sort()).toEqual(['I live in Ohio', 'I play the cello']);
  });

  it('keeps the most recently used memories when they don’t all fit', async () => {
    const h = createHarness();
    const chatgpt = new FakeChatGpt('x'.repeat(1300));
    for (let i = 0; i < 10; i += 1) await h.service.create({ content: `Memory number ${i} ${'y'.repeat(20)}` });
    await sync(h, 'chatgpt', chatgpt);
    expect(chatgpt.field.length).toBeLessThanOrEqual(1500);
    expect(chatgpt.lines().length).toBeGreaterThan(0);
    expect(chatgpt.lines().length).toBeLessThan(10);
    expect((await h.sync.state('chatgpt')).notes[0]).toMatch(/don’t fit/);
    expect(await pending(h, 'chatgpt')).toBe(0);
  });
});

describe('both chatbots together', () => {
  it('an entry approved from Gemini reaches ChatGPT without a second copy in Gemini, and deleting it removes it from both', async () => {
    const h = createHarness();
    const gemini = new FakeGemini();
    const chatgpt = new FakeChatGpt();
    gemini.add('I am learning PID tuning');

    await sync(h, 'gemini', gemini);
    const [item] = await h.sync.allFound();
    expect(await h.sync.review([{ id: item.id, text: item.text }], [])).toEqual({ added: 1, refused: [] });

    expect((await sync(h, 'gemini', gemini)).ops).toEqual([]);
    expect(gemini.texts()).toEqual(['I am learning PID tuning']);
    await sync(h, 'chatgpt', chatgpt);
    expect(chatgpt.lines()).toEqual(['I am learning PID tuning']);

    const [memory] = await h.service.library();
    await h.service.remove([memory.id]);
    await sync(h, 'gemini', gemini);
    await sync(h, 'chatgpt', chatgpt);
    expect(gemini.items.size).toBe(0);
    expect(chatgpt.field).toBe('');
  });
});

describe('message validation', () => {
  it('rejects malformed sync messages', () => {
    expect(parseRequest({ type: 'sync/begin' })).toBeNull();
    expect(parseRequest({ type: 'sync/begin', remote: { managed: 'x', readOnly: [] } })).toBeNull();
    expect(parseRequest({ type: 'sync/begin', remote: { managed: [{ id: 1, text: 'a' }], readOnly: [] } })).toBeNull();
    expect(
      parseRequest({ type: 'sync/begin', remote: { managed: [{ id: 'a', text: 'x'.repeat(5000) }], readOnly: [] } }),
    ).toBeNull();
    expect(parseRequest({ type: 'sync/commit', planId: '../x', results: [], after: null })).toBeNull();
    expect(parseRequest({ type: 'sync/commit', planId: 'p1', results: [{ ok: 'yes' }], after: null })).toBeNull();
    expect(parseRequest({ type: 'sync/cache', key: 'a b', value: '' })).toBeNull();
    expect(parseRequest({ type: 'sync/begin', remote: { managed: [], readOnly: [], blockBudget: 99999 } })).toEqual({
      type: 'sync/begin',
      remote: { managed: [], readOnly: [], blockBudget: 5000, unchangedGroups: undefined, needsRewrite: undefined },
    });
  });
});

describe('reading the chatbots’ replies', () => {
  it('parses a Gemini list reply (format captured from gemini.google.com)', () => {
    const body = `)]}'\n\n410\n[["wrb.fr","ZKcapf","[[[\\"0006a\\",\\"I program VEX robots using PROS and LemLib.\\",[1794688903,638272000],null,[1794688903,638272000],null,null,null,null,1,2]],\\"tokenABC\\"]",null,null,null,"generic"],["di",195]]\n25\n[["e",4,null,null,446]]\n`;
    expect(parseBatchResponse(body, 'ZKcapf')).toEqual([
      [['0006a', 'I program VEX robots using PROS and LemLib.', [1794688903, 638272000], null, [1794688903, 638272000], null, null, null, null, 1, 2]],
      'tokenABC',
    ]);
    expect(() => parseBatchResponse(body, 'xVRQX')).toThrow(/unexpected/);
    const refused = `)]}'\n\n[["wrb.fr","xVRQX",null,null,null,[3],"generic"]]\n`;
    expect(() => parseBatchResponse(refused, 'xVRQX')).toThrow(/didn’t accept/);
  });

  it('parses ChatGPT’s memory summary stream (format captured from chatgpt.com)', () => {
    const body = [
      'event: started\ndata: {"generatedAtIso": "2026-11-14T20:37:21Z"}',
      'event: section\ndata: {"section": {"id": "overview", "title": "Overview", "description": "draft"}}',
      'event: done\ndata: {"sections": [{"id": "overview", "title": "Overview", "description": "You program VEX robots."}, {"id": "vex-robotics", "title": "VEX Robotics", "description": "You use LemLib."}]}',
      'data: [DONE]',
    ].join('\n\n');
    expect(parseSummaryStream(body)).toEqual([
      { id: 'overview', title: 'Overview', description: 'You program VEX robots.' },
      { id: 'vex-robotics', title: 'VEX Robotics', description: 'You use LemLib.' },
    ]);
  });

  it('round-trips the ChatGPT block without touching the user’s text', () => {
    const field = `Line one of mine.\n\n${BLOCK_START}\n- A\n- B\n${BLOCK_END}\n\nMore of mine.`;
    const parsed = parseBlock(field);
    expect(parsed.lines).toEqual(['A', 'B']);
    expect(parsed.outside).toBe('Line one of mine.\n\nMore of mine.');
    expect(parseBlock(composeBlockField(parsed.outside, ['C'])).lines).toEqual(['C']);
    expect(composeBlockField('Mine', [])).toBe('Mine');
  });
});

// The field a user's ChatGPT account actually ended up with, from an earlier
// version whose parser stopped at marker text copied into a memory.
const S = BLOCK_START;
const E = BLOCK_END;
const FISH = 'I eat fish for science experiments in school.';
const CORRUPTED = [
  `- ${FISH}`, E, '', '- ', '', '- ', '', `- ; - ${FISH};`, E, '', '- ', '', `- ; - ${FISH};`, E, '',
  `- ${S}; - ${FISH};`, E, '', S, `- ${S}; - ${FISH}; ${E}`, `- ${S}; - ${FISH};`, E, '',
  S, `- ${S}; - ${FISH}; ${E}`, `- ; - ${FISH};`, E, '',
  S, `- ${S}; - ${FISH}; ${E}`, `- ${S}; - ${FISH};`, E,
].join('\n');

describe('recovering from a damaged ChatGPT block', () => {
  it('reads the damaged field as one OmniMemory line and no user text', () => {
    expect(parseBlock(CORRUPTED)).toEqual({ outside: '', lines: [FISH], present: true });
  });

  it('keeps the user’s own text around a damaged block', () => {
    const field = `My own note.\n\n- ${FISH}\n${E}\n\nAnother note of mine.`;
    expect(parseBlock(field)).toEqual({ outside: 'My own note.\n\nAnother note of mine.', lines: [FISH], present: true });
  });

  it('never writes marker text, even if a memory contains it', () => {
    expect(blockLine(`${S}\n- ${FISH}\n${E}`)).toBe(`${FISH}`);
    expect(blockLine(`${S}\n- ${FISH}\n${E}`)).not.toContain('[');
    expect(repairContent(`${S}; - ${FISH}; ${E}`)).toBe(FISH);
    expect(repairContent(FISH)).toBeNull();
  });

  it('repairs damaged memories and the field in one sync, without unsharing anything', async () => {
    const h = createHarness();
    const chatgpt = new FakeChatGpt(CORRUPTED);
    const good = await h.service.create({ content: FISH });
    const bad1 = await h.service.create({ content: `${S}\n- ${FISH}\n${E}` });
    const bad2 = await h.service.create({ content: `; - ${FISH};` });

    await sync(h, 'chatgpt', chatgpt);

    expect(chatgpt.field).toBe(`${S}\n- ${FISH}\n${E}`);
    const library = await h.service.library();
    expect(library.map((m) => m.content)).toEqual([FISH]);
    expect((await h.service.get(good.id))?.permissions.chatgpt).toBe(true);
    expect((await h.service.get(bad1.id))?.status).toBe('deleted');
    expect((await h.service.get(bad2.id))?.status).toBe('deleted');
    expect((await h.sync.state('chatgpt')).notes[0]).toMatch(/Repaired 2 memories/);

    // Stable afterwards.
    expect((await sync(h, 'chatgpt', chatgpt)).ops).toEqual([]);
    expect(await pending(h, 'chatgpt')).toBe(0);
  });

  it('writes two memories that say the same thing as one line, and settles', async () => {
    const h = createHarness();
    const chatgpt = new FakeChatGpt();
    await h.service.create({ content: 'I like tea' });
    await h.service.create({ content: 'i like tea.' });
    await sync(h, 'chatgpt', chatgpt);
    expect(chatgpt.lines()).toHaveLength(1);
    expect(await pending(h, 'chatgpt')).toBe(0);
    expect((await sync(h, 'chatgpt', chatgpt)).ops).toEqual([]);
  });

  it('accepts a ChatGPT summary section with no text instead of rejecting the sync', async () => {
    const h = createHarness();
    const remote = {
      managed: [],
      readOnly: [
        { id: 'summary-overview', group: 'Memory summary (written by ChatGPT)', title: 'Overview', text: 'You build robots.' },
        { id: 'summary-dive-deeper', group: 'Memory summary (written by ChatGPT)', title: 'Dive Deeper', text: '' },
      ],
    };
    const begin = await h.ask('chatgpt', { type: 'sync/begin', remote });
    expect(begin.status).toBe('ready');
    const entries = (await h.sync.state('chatgpt')).snapshot?.entries ?? [];
    expect(entries.map((e) => e.id)).toEqual(['summary-overview']);
  });

  it('says why a request was rejected', () => {
    expect(parseRequestWithReason({ type: 'sync/begin', remote: { managed: [{ id: 'a', text: 5 }], readOnly: [] } })).toEqual({
      error: 'managed.text must be a string',
    });
    expect(parseRequestWithReason({ type: 'nope' })).toEqual({ error: 'unknown request type' });
  });
});

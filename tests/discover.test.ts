import { describe, expect, it } from 'vitest';
import { candidatesFrom, discover, splitSentences, textKey, toFirstPerson, type FoundItem } from '../src/core/discover';
import type { RemoteSnapshot, SyncOp, OpResult } from '../src/core/sync';
import { createHarness } from './helpers';

describe('turning what a chatbot remembers into suggestions', () => {
  it('rewrites second-person summaries as first-person notes', () => {
    expect(toFirstPerson('You program VEX robots using PROS and LemLib.')).toBe('I program VEX robots using PROS and LemLib.');
    expect(toFirstPerson('Your VEX programming work uses PROS and LemLib.')).toBe('My VEX programming work uses PROS and LemLib.');
    expect(toFirstPerson('You’re learning how to tune PID controllers.')).toBe('I’m learning how to tune PID controllers.');
    expect(toFirstPerson('You are a high-school student.')).toBe('I am a high-school student.');
    expect(toFirstPerson('Guidance tied to your setup helps you most.')).toBe('Guidance tied to my setup helps me most.');
    expect(toFirstPerson('User likes dark mode.')).toBe('I like dark mode.');
    expect(toFirstPerson('User is a robotics coach.')).toBe('I am a robotics coach.');
  });

  it('splits paragraphs into sentences without breaking version numbers', () => {
    expect(splitSentences('You use Python 3.13 daily. You like tea.\n- You live in Ohio')).toEqual([
      'You use Python 3.13 daily.',
      'You like tea.',
      'You live in Ohio',
    ]);
  });

  it('shapes custom-instruction fields into memories', () => {
    expect(candidatesFrom({ group: 'Custom instructions', title: 'Nickname', text: 'Ace' })).toEqual(['Call me Ace.']);
    expect(candidatesFrom({ group: 'Custom instructions', title: 'Occupation', text: 'Student' })).toEqual(['My occupation: Student']);
    expect(
      candidatesFrom({ group: 'Custom instructions', title: 'How ChatGPT should respond', text: 'Be brief. Use examples.', whole: true }),
    ).toEqual(['Be brief. Use examples.']);
    // Too short to be a useful memory on its own.
    expect(candidatesFrom({ group: 'Memory summary (written by ChatGPT)', text: 'Yes. Robotics.' })).toEqual([]);
  });
});

describe('discover', () => {
  it('skips what OmniMemory already has, credentials and skipped items; flags conflicts', async () => {
    const h = createHarness();
    await h.service.create({ content: 'I program VEX robots using PROS and LemLib.' });
    await h.service.create({ content: 'I use Python 3.11' });
    const memories = await h.service.library();
    const sources = [
      {
        group: 'Memory summary (written by ChatGPT)',
        title: 'Overview',
        text: 'You program VEX robots using PROS and LemLib. You use Python 3.13. You eat fish for science experiments in school.',
      },
      { group: 'Saved memories', text: 'User password is hunter2hunter2!' },
      { group: 'Saved memories', text: 'User likes dark mode in every app.' },
    ];
    const skipped = [textKey('I like dark mode in every app.')];
    const found = discover('chatgpt', sources, memories, skipped);
    expect(found.map((item) => item.text)).toEqual(['I use Python 3.13.', 'I eat fish for science experiments in school.']);
    expect(found[0].conflictsWith).toBe('I use Python 3.11');
    expect(found[1].conflictsWith).toBeUndefined();
    expect(found[1].source).toBe('Memory summary (written by ChatGPT)');
    expect(found[1].title).toBe('Overview');
  });

  it('gives the same id to the same text every time', () => {
    const one = discover('gemini', [{ group: 'g', text: 'I like tea a lot', whole: true }], [], []);
    const two = discover('gemini', [{ group: 'g', text: 'i like tea a lot.', whole: true }], [], []);
    expect(one[0].id).toBe(two[0].id);
  });
});

/** Minimal Gemini stand-in (adds a full stop like the real one). */
function fakeGemini() {
  const items = new Map<string, string>();
  let next = 0;
  return {
    items,
    add(text: string) {
      items.set(`g${(next += 1)}`, text);
    },
    snapshot(): RemoteSnapshot {
      return { managed: [...items].map(([id, text]) => ({ id, text })), readOnly: [] };
    },
    apply(op: SyncOp): OpResult {
      const saved = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
      if (op.op === 'create') {
        const id = `g${(next += 1)}`;
        items.set(id, saved(op.text));
        return { ok: true, remoteId: id, remoteText: items.get(id) };
      }
      if (op.op === 'update') {
        items.set(op.remoteId, saved(op.text));
        return { ok: true, remoteId: op.remoteId, remoteText: items.get(op.remoteId) };
      }
      if (op.op === 'delete') {
        items.delete(op.remoteId);
        return { ok: true };
      }
      return { ok: false };
    },
  };
}

type Harness = ReturnType<typeof createHarness>;
async function syncGemini(h: Harness, remote: ReturnType<typeof fakeGemini>) {
  const begin = await h.ask('gemini', { type: 'sync/begin', remote: remote.snapshot() });
  if (begin.status !== 'ready') return [];
  const results = begin.ops.map((op) => remote.apply(op));
  await h.ask('gemini', { type: 'sync/commit', planId: begin.planId, results, after: remote.snapshot() });
  return begin.ops;
}

async function syncChatGpt(h: Harness, readOnly: RemoteSnapshot['readOnly']) {
  const begin = await h.ask('chatgpt', { type: 'sync/begin', remote: { managed: [], readOnly, blockBudget: 1500 } });
  if (begin.status !== 'ready') return [];
  await h.ask('chatgpt', { type: 'sync/commit', planId: begin.planId, results: begin.ops.map(() => ({ ok: true })), after: null });
  return begin.ops;
}

describe('the Review checklist', () => {
  it('finds things in ChatGPT’s memory summary during sync', async () => {
    const h = createHarness();
    await syncChatGpt(h, [
      { id: 'summary-overview', group: 'Memory summary (written by ChatGPT)', title: 'Overview', text: 'You eat fish for science experiments in school. You live near a lake.' },
    ]);
    expect((await h.sync.allFound()).map((item: FoundItem) => item.text)).toEqual([
      'I eat fish for science experiments in school.',
      'I live near a lake.',
    ]);
  });

  it('keeps ticked items (with edits) as memories, skips the rest for good, and can bring skipped back', async () => {
    const h = createHarness();
    const summary = [
      { id: 'summary-overview', group: 'Memory summary (written by ChatGPT)', title: 'Overview', text: 'You eat fish for science experiments in school. You live near a lake.' },
    ];
    await syncChatGpt(h, summary);
    const [fish, lake] = await h.sync.allFound();

    const result = await h.sync.review([{ id: fish.id, text: 'I eat fish for biology experiments at school.' }], [lake.id]);
    expect(result).toEqual({ added: 1, refused: [] });
    const [memory] = await h.service.library();
    expect(memory.content).toBe('I eat fish for biology experiments at school.');
    expect(memory.source).toBe('chatgpt');
    expect(memory.permissions).toEqual({ chatgpt: true, claude: true, gemini: true });
    expect(await h.sync.allFound()).toEqual([]);

    // A later scan doesn't suggest either of them again.
    h.advanceHours(1);
    await syncChatGpt(h, summary);
    expect(await h.sync.allFound()).toEqual([]);

    await h.sync.resetSkipped();
    await syncChatGpt(h, summary);
    expect((await h.sync.allFound()).map((item) => item.text)).toEqual(['I live near a lake.']);
  });

  it('refuses to keep text that looks like a credential, even after editing', async () => {
    const h = createHarness();
    await syncChatGpt(h, [{ id: 'summary-a', group: 'Memory summary (written by ChatGPT)', text: 'You like long walks on the beach.' }]);
    const [item] = await h.sync.allFound();
    const result = await h.sync.review([{ id: item.id, text: 'my password is hunter2hunter2!' }], []);
    expect(result.added).toBe(0);
    expect(result.refused).toHaveLength(1);
    expect(await h.service.library()).toEqual([]);
  });

  it('an approved Gemini entry that was reworded updates the same Gemini entry', async () => {
    const h = createHarness();
    const gemini = fakeGemini();
    gemini.add('Use bullets'); // short, but saved on purpose: still suggested
    gemini.add('I prefer metric units always');
    await syncGemini(h, gemini);
    const [bullets, units] = await h.sync.allFound();
    expect(bullets.text).toBe('Use bullets');
    expect(units.remoteId).toBe('g2');

    await h.sync.review([{ id: units.id, text: 'I prefer metric units' }], [bullets.id]);
    const ops = await syncGemini(h, gemini);
    expect(ops.map((op) => op.op)).toEqual(['update']);
    expect([...gemini.items]).toEqual([
      ['g1', 'Use bullets'],
      ['g2', 'I prefer metric units.'],
    ]);
    expect(await syncGemini(h, gemini)).toEqual([]);
  });
});

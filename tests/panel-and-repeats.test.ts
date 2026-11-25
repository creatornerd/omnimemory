import { describe, expect, it } from 'vitest';
import { suggestCategory } from '../src/core/categorize';
import { discover, groupFinds, type FoundItem } from '../src/core/discover';
import { findSimilar } from '../src/core/duplicates';
import { searchMemories } from '../src/core/search';
import { blockLanded, composeBlockField, emptySyncState, type OpResult, type RemoteSnapshot, type SyncOp } from '../src/core/sync';
import type { Memory } from '../src/core/types';
import { createHarness, createSyncHarness } from './helpers';

function memory(content: string, extra: Partial<Memory> = {}): Memory {
  return {
    id: content,
    content,
    category: 'Other',
    tags: [],
    source: 'manual',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    enabled: true,
    permissions: { chatgpt: true, claude: true, gemini: true },
    status: 'active',
    history: [],
    ...extra,
  };
}

function kind(a: string, b: string) {
  return findSimilar(a, [memory(b)])[0]?.kind ?? null;
}

describe('in-chat panel requests', () => {
  it('refuses to save the exact same words twice', async () => {
    const { ask } = createHarness();
    await ask('chatgpt', { type: 'memory/create', content: 'I coach a youth soccer team.', tags: [] });
    await expect(
      ask('chatgpt', { type: 'memory/create', content: 'i coach a youth soccer team', tags: [] }),
    ).rejects.toThrow('already have this memory');
  });

  it('only compares with memories that page can see', async () => {
    const { ask, service } = createHarness();
    await service.create({ content: 'A private note', permissions: { chatgpt: false } });
    await expect(ask('chatgpt', { type: 'memory/create', content: 'A private note', tags: [] })).resolves.toBeTruthy();
  });

  it('saves with the sharing chosen in the panel', async () => {
    const { ask, service } = createHarness();
    const saved = await ask('chatgpt', {
      type: 'memory/create',
      content: 'I shoot wildlife photography.',
      tags: [],
      permissions: { claude: false },
    });
    const stored = await service.get(saved.id);
    expect(stored?.permissions).toEqual({ chatgpt: true, claude: false, gemini: true });
    expect(saved.source).toBe('chatgpt');
  });

  it('uses each chatbot’s own sharing rule for memories saved there', async () => {
    const { ask, service } = createHarness();
    await service.updateSettings({ sourceDefaults: { chatgpt: { claude: false } } });
    const settings = await service.getSettings();
    expect(settings.sourceDefaults.chatgpt).toEqual({ chatgpt: true, claude: false, gemini: true });
    const fromChatgpt = await ask('chatgpt', { type: 'memory/create', content: 'Saved on ChatGPT', tags: [] });
    const fromGemini = await ask('gemini', { type: 'memory/create', content: 'Saved on Gemini', tags: [] });
    expect((await service.get(fromChatgpt.id))?.permissions.claude).toBe(false);
    expect((await service.get(fromGemini.id))?.permissions.claude).toBe(true);
    // The panel is told, so its Share-with switches start out right.
    const query = await ask('chatgpt', { type: 'context/query', query: '', pageText: '' });
    expect(query.shareDefaults.claude).toBe(false);
    await service.updateSettings({ sourceDefaults: { chatgpt: null } });
    expect((await service.getSettings()).sourceDefaults.chatgpt).toBeUndefined();
  });

  it('undoes a hide or delete made from the same chatbot', async () => {
    const { ask, service, visibleTo } = createHarness();
    const a = await service.create({ content: 'I live in Austin, Texas.' });
    const b = await service.create({ content: 'I prefer metric units.' });

    await ask('claude', { type: 'memory/unshare', id: a.id });
    expect(await visibleTo('claude')).not.toContain(a.content);
    await ask('claude', { type: 'memory/undo', id: a.id });
    expect(await visibleTo('claude')).toContain(a.content);

    await ask('claude', { type: 'memory/delete', id: b.id });
    expect((await service.get(b.id))?.status).toBe('deleted');
    await expect(ask('chatgpt', { type: 'memory/undo', id: b.id })).rejects.toThrow('can’t be undone');
    await ask('claude', { type: 'memory/undo', id: b.id });
    expect((await service.get(b.id))?.status).toBe('active');
    // Only once, and only for something actually removed.
    await expect(ask('claude', { type: 'memory/undo', id: b.id })).rejects.toThrow('can’t be undone');
  });
});

describe('finding memories', () => {
  it('forgives a typo and knows a few synonyms', () => {
    const list = [memory('I build robots for a robotics club.'), memory('I like short, direct answers.')];
    expect(searchMemories(list, 'robtics').map((m) => m.content)).toEqual(['I build robots for a robotics club.']);
    expect(searchMemories(list, 'concise').map((m) => m.content)).toEqual(['I like short, direct answers.']);
    expect(searchMemories(list, 'brief replies').map((m) => m.content)).toEqual(['I like short, direct answers.']);
    expect(searchMemories(list, 'zebra')).toEqual([]);
  });

  it('puts hobbies and preferences in sensible categories', () => {
    expect(suggestCategory('I shoot wildlife photography on weekends.')).toBe('Personal');
    expect(suggestCategory('I coach my daughter’s soccer team.')).toBe('Personal');
    expect(suggestCategory('I prefer short answers with bullet points.')).toBe('Preferences');
    expect(suggestCategory('I am building a budgeting app in React.')).not.toBe('Other');
  });
});

describe('spotting repeats', () => {
  it('treats reworded versions of the same note as repeats', () => {
    expect(kind('I prefer brief replies.', 'I prefer short answers.')).toBe('duplicate');
    expect(kind('I live in Seattle.', 'I live in Seattle, Washington.')).toBe('duplicate');
  });

  it('still tells opposites and different numbers apart', () => {
    expect(kind('I am vegetarian.', 'I am not vegetarian.')).toBe('conflict');
    expect(kind('I have 2 kids.', 'I have 3 kids.')).toBe('conflict');
    expect(kind('I live in Seattle.', 'I like jazz.')).toBeNull();
  });

  it('shows a fact found on several chatbots once', () => {
    const find = (site: FoundItem['site'], text: string, remoteId?: string): FoundItem => ({
      id: `${site}-${text}`,
      site,
      source: 'Memory summary',
      text,
      original: text,
      remoteId,
    });
    const groups = groupFinds([
      find('chatgpt', 'I am a nurse in Seattle.'),
      find('claude', 'I am a nurse in Seattle'),
      find('gemini', 'I am a nurse in Seattle.', 'g1'),
      find('claude', 'I play the cello.'),
    ]);
    expect(groups).toHaveLength(2);
    // The copy that can be linked back to its chatbot's entry is the one shown.
    expect(groups[0].shown.site).toBe('gemini');
    expect(groups[0].shown.alsoOn).toEqual(['chatgpt', 'claude']);
    expect(groups[1].shown.alsoOn).toBeUndefined();
  });

  it('doesn’t offer back something you deleted', () => {
    const found = discover(
      'chatgpt',
      [{ group: 'Saved memories', text: 'I am learning Spanish.', whole: true }],
      [memory('I am learning Spanish.', { status: 'deleted' })],
      [],
    );
    expect(found).toEqual([]);
  });

  it('keeps one memory when the same find is kept from the Review page', async () => {
    const h = createHarness();
    const item = (site: 'chatgpt' | 'claude'): FoundItem => ({
      id: `${site}-x`,
      site,
      source: 'Memory summary',
      text: 'I volunteer at the animal shelter.',
      original: 'You volunteer at the animal shelter.',
    });
    await h.backend.putSyncState({ ...emptySyncState('chatgpt'), found: [item('chatgpt')] });
    await h.backend.putSyncState({ ...emptySyncState('claude'), found: [item('claude')] });

    const listed = await h.sync.allFound();
    expect(listed).toHaveLength(1);
    const result = await h.sync.review([{ id: listed[0].id, text: listed[0].text }], []);
    expect(result.added).toBe(1);
    expect((await h.service.library()).map((m) => m.content)).toEqual(['I volunteer at the animal shelter.']);
    expect(await h.sync.allFound()).toEqual([]);
  });
});

describe('sync reliability', () => {
  it('accepts a block the chatbot saved with tidied spacing or a full stop', () => {
    const field = composeBlockField('About me', ['I like jazz.', 'I live in Ohio']);
    expect(blockLanded(field.replace('I live in Ohio', 'I live in Ohio.'), 'About me', ['I like jazz', 'I live in Ohio'])).toBe(true);
    expect(blockLanded(field, 'About me changed', ['I like jazz', 'I live in Ohio'])).toBe(false);
    expect(blockLanded(field, 'About me', ['I like jazz'])).toBe(false);
  });

  it('offers to remove a second copy on Gemini, and removes only that one', async () => {
    const h = await createSyncHarness();
    const note = await h.service.create({ content: 'I am vegetarian' });
    const items = new Map<string, string>();
    let next = 0;
    const snapshot = (): RemoteSnapshot => ({ managed: [...items].map(([id, text]) => ({ id, text })), readOnly: [] });
    const apply = (op: SyncOp): OpResult => {
      if (op.op === 'create') {
        const id = `g${(next += 1)}`;
        items.set(id, `${op.text}.`);
        return { ok: true, remoteId: id, remoteText: items.get(id) };
      }
      if (op.op === 'delete') {
        items.delete(op.remoteId);
        return { ok: true };
      }
      return { ok: false, error: 'unsupported' };
    };
    const run = async () => {
      const begin = await h.ask('gemini', { type: 'sync/begin', remote: snapshot() });
      if (begin.status !== 'ready') throw new Error(begin.status);
      const results = begin.ops.map(apply);
      await h.ask('gemini', { type: 'sync/commit', planId: begin.planId, results, after: snapshot() });
    };

    await run();
    expect([...items.values()]).toEqual(['I am vegetarian.']);
    items.set('extra', 'I am vegetarian.'); // a save that went through twice
    await run();
    const held = await h.sync.allHeld();
    expect(held).toMatchObject([{ kind: 'delete', repeat: true, remoteText: 'I am vegetarian.', memoryId: note.id }]);
    expect(items.size).toBe(2); // nothing removed without an OK

    await h.sync.decide('gemini', held[0].key, true);
    await run();
    expect([...items.keys()]).toEqual(['g1']);
    expect(await h.sync.allHeld()).toEqual([]);
  });

  it('answers a "Sync now" that was asked for before the chatbot’s tab had loaded', async () => {
    const h = await createSyncHarness();
    await h.sync.setCache('gemini', 'requested', '1');
    expect((await h.ask('gemini', { type: 'sync/status' })).cache.requested).toBe('1');
    await h.ask('gemini', { type: 'sync/begin', remote: { managed: [], readOnly: [] } });
    expect((await h.ask('gemini', { type: 'sync/status' })).cache.requested).toBeUndefined();
  });
});

describe('Gemini account', () => {
  it('sends requests to the Google account the page is using', async () => {
    const { accountPrefix } = await import('../src/content/sync/gemini');
    expect(accountPrefix('/app')).toBe('');
    expect(accountPrefix('/app/abc123')).toBe('');
    expect(accountPrefix('/u/1/app')).toBe('/u/1');
    expect(accountPrefix('/u/12/app/xyz')).toBe('/u/12');
    expect(accountPrefix('/u/1')).toBe('/u/1');
    expect(accountPrefix('/users/1/app')).toBe('');
  });
});

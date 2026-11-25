import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/background/router';
import { parseRequest } from '../src/shared/messages';
import { siteFromUrl } from '../src/shared/sites';
import { createHarness } from './helpers';

describe('sender → site mapping', () => {
  it('accepts only the exact supported HTTPS hosts', () => {
    expect(siteFromUrl('https://chatgpt.com/c/123')).toBe('chatgpt');
    expect(siteFromUrl('https://claude.ai/new')).toBe('claude');
    expect(siteFromUrl('https://gemini.google.com/app')).toBe('gemini');
  });

  it('rejects look-alikes, other schemes and garbage', () => {
    expect(siteFromUrl('https://chatgpt.com.evil.example/')).toBeNull();
    expect(siteFromUrl('https://evil.example/?https://claude.ai')).toBeNull();
    expect(siteFromUrl('https://notclaude.ai/')).toBeNull();
    expect(siteFromUrl('http://chatgpt.com/')).toBeNull();
    expect(siteFromUrl('https://google.com/')).toBeNull();
    expect(siteFromUrl('not a url')).toBeNull();
    expect(siteFromUrl(undefined)).toBeNull();
  });
});

describe('message validation', () => {
  it.each([
    null,
    'context/query',
    {},
    { type: 'memory/purge', id: 'x' },
    { type: 'memory/update', id: 'abc' },
    { type: 'memory/update', id: '../etc', content: 'x' },
    { type: 'memory/create', content: '' },
    { type: 'memory/create', content: 'x'.repeat(2001) },
    { type: 'memory/create', content: 'ok', category: 'Secrets' },
    { type: 'context/query', query: 'x'.repeat(201) },
    { type: 'context/query', pageText: 'x'.repeat(6001) },
    { type: 'context/build', ids: 'abc' },
    { type: 'context/build', ids: Array.from({ length: 101 }, (_, i) => `id${i}`) },
    { type: 'ui/open-dashboard', view: 'javascript:alert(1)' },
  ])('rejects %j', (raw) => {
    expect(parseRequest(raw)).toBeNull();
  });

  it('accepts well-formed requests and fills defaults', () => {
    expect(parseRequest({ type: 'context/query' })).toEqual({ type: 'context/query', query: '', pageText: '' });
    expect(parseRequest({ type: 'ui/open-dashboard' })).toEqual({ type: 'ui/open-dashboard', view: 'library' });
    expect(parseRequest({ type: 'memory/delete', id: 'a1-b2', extra: 'ignored' })).toEqual({
      type: 'memory/delete',
      id: 'a1-b2',
    });
  });

  it('refuses requests from pages that are not a supported chatbot', async () => {
    const { service } = createHarness();
    const response = await handleRequest({ type: 'context/query' }, null, {
      service,
      openDashboard: () => {},
    });
    expect(response.ok).toBe(false);
  });
});

describe('router — what a chatbot page can do', () => {
  it('returns only memories shared with the calling site', async () => {
    const { service, visibleTo } = createHarness();
    await service.create({ content: 'Shared everywhere' });
    await service.create({ content: 'Not for Gemini', permissions: { gemini: false } });
    await service.create({ content: 'Private note', enabled: false });

    expect((await visibleTo('chatgpt')).sort()).toEqual(['Not for Gemini', 'Shared everywhere']);
    expect(await visibleTo('gemini')).toEqual(['Shared everywhere']);
  });

  it('exposes only the public fields of a memory', async () => {
    const { service, ask } = createHarness();
    await service.create({ content: 'Fact', source: 'claude' });
    const result = await ask('chatgpt', { type: 'context/query', query: '', pageText: '' });
    expect(Object.keys(result.items[0].memory).sort()).toEqual(['category', 'content', 'id', 'source', 'tags', 'updated_at']);
  });

  it('flags memories relevant to the conversation and searches on demand', async () => {
    const { service, ask } = createHarness();
    await service.create({ content: 'I program VEX robots using PROS and LemLib' });
    await service.create({ content: 'I am vegetarian' });

    const ranked = await ask('claude', {
      type: 'context/query',
      query: '',
      pageText: 'my VEX robot overshoots when using LemLib',
    });
    expect(ranked.items[0]).toMatchObject({ relevant: true });
    expect(ranked.items[0].memory.content).toMatch(/VEX/);
    expect(ranked.items[1].relevant).toBe(false);

    const searched = await ask('claude', { type: 'context/query', query: 'veget', pageText: '' });
    expect(searched.items.map((i) => i.memory.content)).toEqual(['I am vegetarian']);
  });

  it('ignores page text when the user turned that off', async () => {
    const { service, ask } = createHarness();
    await service.create({ content: 'I program VEX robots using PROS and LemLib' });
    await service.updateSettings({ relevanceFromPage: false });
    const result = await ask('claude', { type: 'context/query', query: '', pageText: 'VEX robots LemLib PROS' });
    expect(result.items[0].relevant).toBe(false);
  });

  it('returns nothing while paused, and says why', async () => {
    const { service, ask } = createHarness();
    await service.create({ content: 'Fact' });

    await service.updateSettings({ sitePaused: { claude: true } as never });
    expect(await ask('claude', { type: 'context/query', query: '', pageText: '' })).toMatchObject({
      blocked: 'site-pause',
      total: 0,
      items: [],
    });
    expect((await ask('chatgpt', { type: 'context/query', query: '', pageText: '' })).items).toHaveLength(1);

    await service.updateSettings({ sharingPaused: true });
    expect(await ask('chatgpt', { type: 'context/query', query: '', pageText: '' })).toMatchObject({
      blocked: 'global-pause',
      items: [],
    });
  });

  it('builds context only from memories that are shareable right now', async () => {
    const { service, ask } = createHarness();
    const a = await service.create({ content: 'Alpha fact' });
    const b = await service.create({ content: 'Beta fact' });
    const c = await service.create({ content: 'Gamma fact', permissions: { claude: false } });

    const built = await ask('claude', { type: 'context/build', ids: [b.id, a.id, c.id, 'unknown'] });
    expect(built.includedIds).toEqual([b.id, a.id]); // caller's order, unshared dropped
    expect(built.text).toContain('- Beta fact\n- Alpha fact');
    expect(built.text).not.toContain('Gamma');

    await service.remove([a.id]);
    await service.update(b.id, { enabled: false });
    expect(await ask('claude', { type: 'context/build', ids: [a.id, b.id] })).toMatchObject({
      text: '',
      includedIds: [],
    });
  });

  it('cannot edit, unshare or delete a memory the site is not allowed to see', async () => {
    const { service, ask } = createHarness();
    const hidden = await service.create({ content: 'Hidden from Gemini', permissions: { gemini: false } });

    await expect(ask('gemini', { type: 'memory/update', id: hidden.id, content: 'hacked' })).rejects.toThrow(
      /not available/,
    );
    await expect(ask('gemini', { type: 'memory/delete', id: hidden.id })).rejects.toThrow(/not available/);
    await expect(ask('gemini', { type: 'memory/unshare', id: hidden.id })).rejects.toThrow(/not available/);
    expect(await service.get(hidden.id)).toMatchObject({ content: 'Hidden from Gemini', status: 'active' });
  });

  it('edits in place, unshares only the calling site, and soft-deletes', async () => {
    const { service, ask } = createHarness();
    const memory = await service.create({ content: 'I use Python 3.11' });

    await ask('chatgpt', { type: 'memory/update', id: memory.id, content: 'I use Python 3.13' });
    expect((await service.get(memory.id))?.content).toBe('I use Python 3.13');

    await ask('chatgpt', { type: 'memory/unshare', id: memory.id });
    expect((await service.get(memory.id))?.permissions).toEqual({ chatgpt: false, claude: true, gemini: true });

    await ask('claude', { type: 'memory/delete', id: memory.id });
    expect((await service.get(memory.id))?.status).toBe('deleted'); // recoverable
  });

  it('records the site as the source of memories saved from it', async () => {
    const { service, ask } = createHarness();
    const saved = await ask('gemini', { type: 'memory/create', content: 'I am learning Rust', tags: [] });
    expect(await service.get(saved.id)).toMatchObject({ source: 'gemini', category: 'Technology' });
  });

  it('refuses to store credentials captured from a page', async () => {
    const { service, ask } = createHarness();
    await expect(
      ask('chatgpt', { type: 'memory/create', content: 'my password is hunter2!', tags: [] }),
    ).rejects.toThrow(/credentials/);
    const memory = await service.create({ content: 'Safe' });
    await expect(
      ask('chatgpt', { type: 'memory/update', id: memory.id, content: 'api_key = abcdef0123456789abcdef' }),
    ).rejects.toThrow(/credentials/);
    expect(await service.library()).toHaveLength(1);
  });

  it('reviews a proposed memory without saving it or leaking unshared ones', async () => {
    const { service, ask } = createHarness();
    await service.create({ content: 'I program VEX robots using PROS and LemLib' });
    await service.create({ content: 'I take 20 mg of medication daily', permissions: { chatgpt: false } });

    const duplicate = await ask('chatgpt', {
      type: 'memory/review',
      content: 'I program VEX robots with PROS and LemLib',
    });
    expect(duplicate.similar[0]).toMatchObject({ kind: 'duplicate' });
    expect(duplicate.suggestedCategory).toBe('Projects');

    const probe = await ask('chatgpt', { type: 'memory/review', content: 'I take 40 mg of medication daily' });
    expect(probe.similar).toEqual([]); // the unshared memory is not revealed
    expect(await service.library()).toHaveLength(2);
  });

  it('marks used only what the site may see, and opens the dashboard on request', async () => {
    const { service, ask, opened } = createHarness();
    const shared = await service.create({ content: 'Shared' });
    const hidden = await service.create({ content: 'Hidden', permissions: { claude: false } });
    await ask('claude', { type: 'context/used', ids: [shared.id, hidden.id] });
    expect((await service.get(shared.id))?.last_used_at).toBeDefined();
    expect((await service.get(hidden.id))?.last_used_at).toBeUndefined();

    await ask('claude', { type: 'ui/open-dashboard', view: 'trash' });
    expect(opened).toEqual(['trash']);
  });
});

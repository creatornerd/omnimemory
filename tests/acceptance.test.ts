import { describe, expect, it } from 'vitest';
import { buildExport } from '../src/core/import-export';
import { createHarness } from './helpers';

/**
 * The MVP acceptance criteria, end to end, against the real storage backend
 * and the real content-script router. `service` plays the popup/dashboard;
 * `ask`/`visibleTo` play a content script on each chatbot site.
 * (Criterion 1, installing in Chrome, is manual — see the README.)
 */
describe('acceptance workflow', () => {
  it('walks through criteria 2–10', async () => {
    const { service, ask, visibleTo } = createHarness();
    const FACT = 'I program VEX robots using PROS and LemLib';

    // 2. Open OmniMemory and save a memory.
    const memory = await service.create({ content: FACT });

    // 3. Visit ChatGPT and retrieve that memory.
    expect(await visibleTo('chatgpt')).toEqual([FACT]);
    expect(await visibleTo('chatgpt', 'vex')).toEqual([FACT]);

    // 4. Visit Claude or Gemini and retrieve the same memory.
    expect(await visibleTo('claude')).toEqual([FACT]);
    expect(await visibleTo('gemini')).toEqual([FACT]);

    // 5. Edit once; the update is seen on every site (same id, no duplicate).
    const EDITED = 'I program VEX V5 robots using PROS and LemLib';
    await service.update(memory.id, { content: EDITED });
    for (const site of ['chatgpt', 'claude', 'gemini'] as const) {
      expect(await visibleTo(site)).toEqual([EDITED]);
      const built = await ask(site, { type: 'context/build', ids: [memory.id] });
      expect(built.text).toContain(`- ${EDITED}`);
    }
    expect(await service.library()).toHaveLength(1);

    // 6. Disable sharing with Gemini; ChatGPT and Claude keep access.
    await service.update(memory.id, { permissions: { gemini: false } });
    expect(await visibleTo('gemini')).toEqual([]);
    expect((await ask('gemini', { type: 'context/build', ids: [memory.id] })).text).toBe('');
    expect(await visibleTo('chatgpt')).toEqual([EDITED]);
    expect(await visibleTo('claude')).toEqual([EDITED]);
    expect(await service.get(memory.id)).toBeDefined(); // not deleted, just unshared

    // 7. Delete; it no longer appears in any retrieval path.
    await service.remove([memory.id]);
    for (const site of ['chatgpt', 'claude', 'gemini'] as const) {
      expect(await visibleTo(site)).toEqual([]);
      expect(await visibleTo(site, 'vex')).toEqual([]);
      expect((await ask(site, { type: 'context/build', ids: [memory.id] })).includedIds).toEqual([]);
    }
    expect(buildExport(await service.all()).memories).toEqual([]);

    // 8. Restore the deleted memory (sharing choices are preserved).
    await service.restore([memory.id]);
    expect(await visibleTo('chatgpt')).toEqual([EDITED]);
    expect(await visibleTo('gemini')).toEqual([]);

    // 9. Export all active memories.
    const file = buildExport(await service.all());
    expect(file.count).toBe(1);
    expect(JSON.parse(JSON.stringify(file)).memories[0]).toMatchObject({ id: memory.id, content: EDITED });

    // 10. All of the above ran against local IndexedDB only: the code under
    // test has no network access (see tests/no-network.test.ts).
  });

  it('global pause stops retrieval everywhere without losing anything', async () => {
    const { service, visibleTo } = createHarness();
    await service.create({ content: 'A fact' });
    await service.updateSettings({ sharingPaused: true });
    for (const site of ['chatgpt', 'claude', 'gemini'] as const) expect(await visibleTo(site)).toEqual([]);
    await service.updateSettings({ sharingPaused: false });
    expect(await visibleTo('claude')).toEqual(['A fact']);
  });

  it('outdated memories stay in the library but are not shared', async () => {
    const { service, visibleTo } = createHarness();
    const memory = await service.create({ content: 'I am in grade 10' });
    await service.setOutdated([memory.id], true);
    expect(await visibleTo('chatgpt')).toEqual([]);
    expect(await service.library()).toHaveLength(1);
  });
});

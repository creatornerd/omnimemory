import { describe, expect, it } from 'vitest';
import { MemoryError } from '../src/core/service';
import { createHarness } from './helpers';

describe('MemoryService — create and read', () => {
  it('creates a memory with a unique id, defaults and a history entry', async () => {
    const { service } = createHarness();
    const a = await service.create({ content: '  I program VEX robots using PROS and LemLib  ' });
    const b = await service.create({ content: 'I prefer concise answers' });

    expect(a.id).not.toBe(b.id);
    expect(a.content).toBe('I program VEX robots using PROS and LemLib');
    expect(a).toMatchObject({
      source: 'manual',
      enabled: true,
      status: 'active',
      permissions: { chatgpt: true, claude: true, gemini: true },
    });
    expect(a.history).toEqual([{ at: a.created_at, action: 'created' }]);
    expect(a.category).toBe('Projects'); // suggested from the text
    expect(b.category).toBe('Preferences');
  });

  it('persists across service instances on the same database', async () => {
    const { service, backend } = createHarness();
    const saved = await service.create({ content: 'I live in Toronto' });
    const { MemoryService } = await import('../src/core/service');
    const reopened = new MemoryService(backend);
    expect((await reopened.get(saved.id))?.content).toBe('I live in Toronto');
  });

  it('rejects empty and oversized content', async () => {
    const { service } = createHarness();
    await expect(service.create({ content: '   ' })).rejects.toBeInstanceOf(MemoryError);
    await expect(service.create({ content: 'x'.repeat(2001) })).rejects.toThrow(/at most/);
  });

  it('normalises tags', async () => {
    const { service } = createHarness();
    const memory = await service.create({ content: 'Tagged', tags: ['#Robotics', ' robotics ', 'C++', ''] });
    expect(memory.tags).toEqual(['robotics', 'c++']);
  });

  it('applies the default sharing settings to new memories', async () => {
    const { service } = createHarness();
    await service.updateSettings({ defaultPermissions: { chatgpt: true, claude: true, gemini: false } });
    const memory = await service.create({ content: 'Something new' });
    expect(memory.permissions).toEqual({ chatgpt: true, claude: true, gemini: false });
  });
});

describe('MemoryService — editing', () => {
  it('updates in place: same id, no duplicate, previous value kept in history', async () => {
    const { service } = createHarness();
    const original = await service.create({ content: 'I use Python 3.11' });
    const edited = await service.update(original.id, { content: 'I use Python 3.13' });

    expect(edited.id).toBe(original.id);
    expect(edited.content).toBe('I use Python 3.13');
    expect(edited.updated_at > original.updated_at).toBe(true);
    expect(edited.created_at).toBe(original.created_at);
    expect(await service.library()).toHaveLength(1);
    expect(edited.history.at(-1)).toMatchObject({
      action: 'edited',
      previous: { content: 'I use Python 3.11' },
    });
  });

  it('does not write or add history when nothing changed', async () => {
    const { service, changes } = createHarness();
    const memory = await service.create({ content: 'Unchanged' });
    const before = changes();
    const same = await service.update(memory.id, { content: 'Unchanged', category: memory.category });
    expect(same.history).toHaveLength(1);
    expect(changes()).toBe(before);
  });

  it('changes sharing without touching the text, timestamp or history', async () => {
    const { service } = createHarness();
    const memory = await service.create({ content: 'Sharing test' });
    const updated = await service.update(memory.id, { permissions: { gemini: false }, enabled: false });
    expect(updated.permissions).toEqual({ chatgpt: true, claude: true, gemini: false });
    expect(updated.enabled).toBe(false);
    expect(updated.updated_at).toBe(memory.updated_at);
    expect(updated.history).toHaveLength(1);
  });

  it('caps history length', async () => {
    const { service } = createHarness();
    const memory = await service.create({ content: 'v0' });
    for (let i = 1; i <= 40; i += 1) await service.update(memory.id, { content: `v${i}` });
    const final = await service.get(memory.id);
    expect(final?.history).toHaveLength(25);
    expect(final?.history.at(-1)?.previous?.content).toBe('v39');
  });

  it('marks memories outdated and current again', async () => {
    const { service } = createHarness();
    const memory = await service.create({ content: 'I am in grade 10' });
    await service.setOutdated([memory.id], true);
    expect((await service.get(memory.id))?.status).toBe('outdated');
    await service.setOutdated([memory.id], false);
    const current = await service.get(memory.id);
    expect(current?.status).toBe('active');
    expect(current?.history.map((h) => h.action)).toEqual(['created', 'marked-outdated', 'marked-current']);
  });

  it('applies bulk updates and skips missing ids', async () => {
    const { service } = createHarness();
    const a = await service.create({ content: 'First' });
    const b = await service.create({ content: 'Second' });
    const count = await service.updateMany([a.id, b.id, 'missing'], { category: 'Education' });
    expect(count).toBe(2);
    expect((await service.library()).every((m) => m.category === 'Education')).toBe(true);
  });
});

describe('MemoryService — trash', () => {
  it('soft-deletes, restores, and keeps the same id', async () => {
    const { service } = createHarness();
    const memory = await service.create({ content: 'Delete me' });
    await service.remove([memory.id]);

    expect(await service.library()).toHaveLength(0);
    const [trashed] = await service.trash();
    expect(trashed).toMatchObject({ id: memory.id, status: 'deleted' });
    expect(trashed.deleted_at).toBeDefined();

    await service.restore([memory.id]);
    const restored = await service.get(memory.id);
    expect(restored?.status).toBe('active');
    expect(restored?.deleted_at).toBeUndefined();
    expect(restored?.history.map((h) => h.action)).toEqual(['created', 'deleted', 'restored']);
  });

  it('restores an outdated memory as outdated', async () => {
    const { service } = createHarness();
    const memory = await service.create({ content: 'Old fact' });
    await service.setOutdated([memory.id], true);
    await service.remove([memory.id]);
    await service.restore([memory.id]);
    expect((await service.get(memory.id))?.status).toBe('outdated');
  });

  it('refuses to edit a memory that is in the trash', async () => {
    const { service } = createHarness();
    const memory = await service.create({ content: 'Trashed' });
    await service.remove([memory.id]);
    await expect(service.update(memory.id, { content: 'Edited' })).rejects.toThrow(/Restore/);
  });

  it('permanently deletes only what is already in the trash', async () => {
    const { service } = createHarness();
    const keep = await service.create({ content: 'Keep' });
    const gone = await service.create({ content: 'Gone' });
    await service.remove([gone.id]);
    await service.purge([keep.id, gone.id]);
    expect(await service.get(keep.id)).toBeDefined();
    expect(await service.get(gone.id)).toBeUndefined();
  });

  it('empties the trash', async () => {
    const { service } = createHarness();
    const a = await service.create({ content: 'One' });
    const b = await service.create({ content: 'Two' });
    await service.create({ content: 'Three' });
    await service.remove([a.id, b.id]);
    expect(await service.emptyTrash()).toBe(2);
    expect(await service.all()).toHaveLength(1);
  });

  it('erases trash after 30 days but not before', async () => {
    const { service, advanceDays } = createHarness();
    const memory = await service.create({ content: 'Expiring' });
    await service.remove([memory.id]);

    advanceDays(29);
    expect(await service.purgeExpired()).toBe(0);
    expect(await service.trash()).toHaveLength(1);

    advanceDays(2);
    expect(await service.purgeExpired()).toBe(1);
    expect(await service.get(memory.id)).toBeUndefined();
  });
});

describe('MemoryService — merge', () => {
  it('keeps the first memory, trashes the rest, and never widens sharing', async () => {
    const { service } = createHarness();
    const a = await service.create({ content: 'I program VEX robots', tags: ['robotics'] });
    const b = await service.create({
      content: 'I program VEX robots with PROS',
      tags: ['pros'],
      permissions: { gemini: false },
    });

    const merged = await service.merge([a.id, b.id], 'I program VEX robots using PROS');
    expect(merged.id).toBe(a.id);
    expect(merged.content).toBe('I program VEX robots using PROS');
    expect(merged.tags).toEqual(['robotics', 'pros']);
    expect(merged.permissions.gemini).toBe(false);
    expect(merged.history.at(-1)).toMatchObject({ action: 'merged', previous: { content: 'I program VEX robots' } });

    expect(await service.library()).toHaveLength(1);
    const [trashed] = await service.trash();
    expect(trashed.id).toBe(b.id); // recoverable
  });

  it('needs at least two memories', async () => {
    const { service } = createHarness();
    const a = await service.create({ content: 'Only one' });
    await expect(service.merge([a.id, a.id], 'x')).rejects.toThrow(/at least two/);
  });
});

describe('MemoryService — settings', () => {
  it('returns defaults and merges partial updates', async () => {
    const { service } = createHarness();
    expect((await service.getSettings()).sharingPaused).toBe(false);
    await service.updateSettings({ sitePaused: { gemini: true } as never });
    const settings = await service.getSettings();
    expect(settings.sitePaused).toEqual({ chatgpt: false, claude: false, gemini: true });
    expect(settings.theme).toBe('system');
  });
});

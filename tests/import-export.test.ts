import { describe, expect, it } from 'vitest';
import { buildExport, parseImport, reviewImport } from '../src/core/import-export';
import { buildContext, CONTEXT_FOOTER, CONTEXT_HEADER, MAX_CONTEXT_CHARS } from '../src/core/context';
import { createHarness } from './helpers';

describe('export', () => {
  it('exports the library (not the trash) by default, with full records', async () => {
    const { service } = createHarness();
    await service.create({ content: 'Keep me', tags: ['a'] });
    const outdated = await service.create({ content: 'Old but kept' });
    await service.setOutdated([outdated.id], true);
    const gone = await service.create({ content: 'Deleted' });
    await service.remove([gone.id]);

    const file = buildExport(await service.all());
    expect(file).toMatchObject({ format: 'omnimemory', version: 1, scope: 'library', count: 2 });
    expect(file.memories.map((m) => m.content).sort()).toEqual(['Keep me', 'Old but kept']);
    expect(file.memories[0]).toHaveProperty('history');
    expect(file.memories[0]).toHaveProperty('permissions');

    expect(buildExport(await service.all(), { includeTrash: true }).count).toBe(3);
  });

  it('round-trips: an export can be imported into an empty library', async () => {
    const source = createHarness();
    await source.service.create({
      content: 'I program VEX robots',
      category: 'Projects',
      tags: ['robotics'],
      source: 'chatgpt',
      permissions: { gemini: false },
    });
    const json = JSON.stringify(buildExport(await source.service.all()));

    const target = createHarness();
    const parsed = parseImport(json);
    expect(parsed.formatLabel).toBe('OmniMemory export');
    const review = reviewImport(parsed.drafts, await target.service.library());
    await target.service.createMany(review.filter((c) => c.selected).map((c) => c.draft));

    const [imported] = await target.service.library();
    expect(imported).toMatchObject({
      content: 'I program VEX robots',
      category: 'Projects',
      tags: ['robotics'],
      source: 'chatgpt',
      permissions: { chatgpt: true, claude: true, gemini: false },
    });
    expect(imported.history[0].action).toBe('imported');
  });
});

describe('import parsing', () => {
  it('reads plain text and strips list markers', () => {
    const parsed = parseImport('- I like tea\n* I live in Leeds\n\n3. I have two cats\n• I cycle to work');
    expect(parsed.drafts.map((d) => d.content)).toEqual([
      'I like tea',
      'I live in Leeds',
      'I have two cats',
      'I cycle to work',
    ]);
    expect(parsed.drafts.every((d) => d.source === 'import')).toBe(true);
  });

  it('reads generic JSON lists of strings or objects', () => {
    const parsed = parseImport(
      JSON.stringify(['First', { text: 'Second' }, { memory: 'Third', tags: ['x', 5] }, { nope: 1 }, 42]),
    );
    expect(parsed.drafts.map((d) => d.content)).toEqual(['First', 'Second', 'Third']);
    expect(parsed.drafts[2].tags).toEqual(['x']);
    expect(parsed.skipped).toBe(2);
  });

  it('does not trust the source field of a foreign file', () => {
    const parsed = parseImport(JSON.stringify([{ content: 'Claims to be manual', source: 'manual' }]));
    expect(parsed.drafts[0].source).toBe('import');
  });

  it('never resurrects trashed memories from an export', () => {
    const parsed = parseImport(
      JSON.stringify({ format: 'omnimemory', memories: [{ content: 'Alive' }, { content: 'Dead', status: 'deleted' }] }),
    );
    expect(parsed.drafts.map((d) => d.content)).toEqual(['Alive']);
  });

  it('gives clear errors for unusable input', () => {
    expect(() => parseImport('   ')).toThrow(/empty/);
    expect(() => parseImport('{ "memories": [')).toThrow(/could not be parsed/);
    expect(() => parseImport('{"hello": "world"}')).toThrow(/No list of memories/);
  });
});

describe('import review', () => {
  it('pre-selects only clean items and never overwrites existing memories', async () => {
    const { service } = createHarness();
    const existing = await service.create({ content: 'I use Python 3.11 for data analysis' });

    const { drafts } = parseImport(
      [
        'I enjoy hiking on weekends',
        'I use Python 3.11 for data analysis',
        'I use Python 3.13 for data analysis',
        'I enjoy hiking on weekends',
        'my password is hunter2!',
      ].join('\n'),
    );
    const review = reviewImport(drafts, await service.library());
    expect(review.map((c) => [c.issue, c.selected])).toEqual([
      ['ok', true],
      ['duplicate', false],
      ['conflict', false],
      ['duplicate', false],
      ['sensitive', false],
    ]);

    // Even if the user ticks the conflicting item, it becomes a *new* memory.
    await service.createMany([review[0].draft, review[2].draft]);
    const library = await service.library();
    expect(library).toHaveLength(3);
    expect((await service.get(existing.id))?.content).toBe('I use Python 3.11 for data analysis');
  });
});

describe('context building', () => {
  it('produces a plain-text block and collapses newlines inside memories', async () => {
    const { service } = createHarness();
    const a = await service.create({ content: 'Line one\nline two' });
    const b = await service.create({ content: '<img src=x onerror=alert(1)>' });
    const built = buildContext([a, b]);
    expect(built.text).toBe(
      [CONTEXT_HEADER, '- Line one line two', '- <img src=x onerror=alert(1)>', CONTEXT_FOOTER].join('\n'),
    );
    expect(built.includedIds).toEqual([a.id, b.id]);
  });

  it('is empty for no memories and truncates rather than overflowing', async () => {
    expect(buildContext([])).toEqual({ text: '', includedIds: [], truncated: false });
    const { service } = createHarness();
    const big = [];
    for (let i = 0; i < 5; i += 1) big.push(await service.create({ content: `${i} ${'word '.repeat(390)}` }));
    const built = buildContext(big);
    expect(built.truncated).toBe(true);
    expect(built.includedIds.length).toBeLessThan(5);
    expect(built.text.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });
});

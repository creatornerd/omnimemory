import { describe, expect, it } from 'vitest';
import { findDuplicateGroups, findSimilar, similarity } from '../src/core/duplicates';
import { findSensitive } from '../src/core/sensitive';
import { suggestCategory } from '../src/core/categorize';
import type { Memory } from '../src/core/types';

function memory(id: string, content: string, status: Memory['status'] = 'active'): Memory {
  return {
    id,
    content,
    category: 'Other',
    tags: [],
    source: 'manual',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    enabled: true,
    permissions: { chatgpt: true, claude: true, gemini: true },
    status,
    history: [],
  };
}

describe('duplicate and conflict detection', () => {
  const existing = [
    memory('robots', 'I program VEX robots using PROS and LemLib'),
    memory('python', 'I use Python 3.11 for data analysis'),
    memory('coffee', 'I like coffee in the morning'),
    memory('trashed', 'I live in Toronto, Canada', 'deleted'),
  ];

  it('scores identical text (ignoring case and spacing) as 1', () => {
    expect(similarity('I like  Coffee', 'i like coffee')).toBe(1);
  });

  it('flags near-identical wording as a duplicate', () => {
    const [match] = findSimilar('I program VEX robots with PROS and LemLib', existing);
    expect(match).toMatchObject({ kind: 'duplicate' });
    expect(match.memory.id).toBe('robots');
  });

  it('flags a changed number as a conflict, not a duplicate', () => {
    const [match] = findSimilar('I use Python 3.13 for data analysis', existing);
    expect(match).toMatchObject({ kind: 'conflict', reason: 'Same topic, different numbers' });
  });

  it('flags a negation as a conflict', () => {
    const [match] = findSimilar("I don't like coffee in the morning", existing);
    expect(match).toMatchObject({ kind: 'conflict', reason: 'One says the opposite of the other' });
  });

  it('ignores unrelated text, trashed memories and the memory being edited', () => {
    expect(findSimilar('My favourite colour is green', existing)).toEqual([]);
    expect(findSimilar('I live in Toronto, Canada', existing)).toEqual([]);
    expect(findSimilar('I like coffee in the morning', existing, 'coffee')).toEqual([]);
  });

  it('groups duplicates for review', () => {
    const groups = findDuplicateGroups([
      ...existing,
      memory('robots2', 'I program VEX robots with PROS and LemLib'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((m) => m.id).sort()).toEqual(['robots', 'robots2']);
  });
});

describe('sensitive text detection', () => {
  it.each([
    ['my password is hunter2!', 'password'],
    ['OPENAI key sk-abcdefghijklmnopqrstuvwxyz123456', 'api-key'],
    ['token: ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'api-key'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
    ['card 4242 4242 4242 4242 exp 12/29', 'card-number'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N', 'token'],
    ['SSN 123-45-6789', 'ssn'],
  ])('flags %s', (text, kind) => {
    expect(findSensitive(text).map((f) => f.kind)).toContain(kind);
  });

  it.each([
    'I program VEX robots using PROS and LemLib',
    'My phone has 256 GB of storage and I was born in 2008',
    'I forgot my password last week and had to reset it',
    'Order number 1234 5678 9012 3456', // fails the Luhn check
  ])('does not flag %s', (text) => {
    expect(findSensitive(text)).toEqual([]);
  });
});

describe('category suggestion', () => {
  it('picks a sensible default and falls back to Other', () => {
    expect(suggestCategory('I am taking AP Physics at school this semester')).toBe('Education');
    expect(suggestCategory('I write TypeScript and React on Linux')).toBe('Technology');
    expect(suggestCategory('Zebras')).toBe('Other');
  });
});

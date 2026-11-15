import { describe, expect, it } from 'vitest';
import { rankByRelevance, searchMemories } from '../src/core/search';
import type { Memory } from '../src/core/types';

function memory(id: string, content: string, extra: Partial<Memory> = {}): Memory {
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
    status: 'active',
    history: [],
    ...extra,
  };
}

const MEMORIES = [
  memory('robots', 'I program VEX robots using PROS and LemLib', { tags: ['robotics'], category: 'Projects' }),
  memory('style', 'I prefer concise answers with code examples first', { category: 'Preferences' }),
  memory('school', 'I am a high-school junior taking AP Physics', { category: 'Education' }),
  memory('laptop', 'My laptop is a MacBook Air running macOS', { updated_at: '2026-02-01T00:00:00.000Z' }),
];

describe('searchMemories', () => {
  it('returns everything, in the given order, for an empty query', () => {
    expect(searchMemories(MEMORIES, '   ')).toEqual(MEMORIES);
  });

  it('matches as you type (prefixes) and ignores case', () => {
    expect(searchMemories(MEMORIES, 'rob').map((m) => m.id)).toEqual(['robots']);
    expect(searchMemories(MEMORIES, 'MACBOOK').map((m) => m.id)).toEqual(['laptop']);
  });

  it('requires every term to match', () => {
    expect(searchMemories(MEMORIES, 'vex pros').map((m) => m.id)).toEqual(['robots']);
    expect(searchMemories(MEMORIES, 'vex macbook')).toEqual([]);
  });

  it('matches tags, categories and word variants', () => {
    expect(searchMemories(MEMORIES, 'robotics').map((m) => m.id)).toEqual(['robots']);
    expect(searchMemories(MEMORIES, 'education').map((m) => m.id)).toEqual(['school']);
    expect(searchMemories(MEMORIES, 'robot').map((m) => m.id)).toEqual(['robots']);
    expect(searchMemories(MEMORIES, 'answer').map((m) => m.id)).toEqual(['style']);
  });

  it('ranks exact word matches above partial ones', () => {
    const list = [memory('partial', 'I enjoy codebreaking puzzles'), memory('exact', 'I write code daily')];
    expect(searchMemories(list, 'code').map((m) => m.id)).toEqual(['exact', 'partial']);
  });
});

describe('rankByRelevance', () => {
  it('surfaces memories that overlap with the conversation', () => {
    const ranked = rankByRelevance(MEMORIES, 'Can you help me tune PID for my VEX robot using LemLib?');
    expect(ranked[0].memory.id).toBe('robots');
    expect(ranked[0].relevant).toBe(true);
    expect(ranked.find((r) => r.memory.id === 'laptop')?.relevant).toBe(false);
  });

  it('marks nothing relevant for empty or unrelated text, falling back to recency', () => {
    const ranked = rankByRelevance(MEMORIES, '');
    expect(ranked.every((r) => !r.relevant)).toBe(true);
    expect(ranked[0].memory.id).toBe('laptop'); // most recently updated
    expect(rankByRelevance(MEMORIES, 'What is the capital of France?').some((r) => r.relevant)).toBe(false);
  });

  it('is not fooled by filler words', () => {
    const ranked = rankByRelevance(MEMORIES, 'I would like you to help me with this and that, please');
    expect(ranked.some((r) => r.relevant)).toBe(false);
  });
});

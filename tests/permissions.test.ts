import { describe, expect, it } from 'vitest';
import { isShareableWith, shareableMemories, sharingBlock, sharingSummary } from '../src/core/permissions';
import { DEFAULT_SETTINGS, type Memory } from '../src/core/types';

const base: Memory = {
  id: 'm1',
  content: 'A fact',
  category: 'Other',
  tags: [],
  source: 'manual',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  enabled: true,
  permissions: { chatgpt: true, claude: true, gemini: true },
  status: 'active',
  history: [],
};

describe('permissions', () => {
  it('shares an active, enabled, permitted memory', () => {
    expect(isShareableWith(base, 'chatgpt')).toBe(true);
  });

  it('respects per-site permissions', () => {
    const memory = { ...base, permissions: { chatgpt: true, claude: true, gemini: false } };
    expect(isShareableWith(memory, 'gemini')).toBe(false);
    expect(isShareableWith(memory, 'claude')).toBe(true);
  });

  it('never shares private, outdated or deleted memories', () => {
    expect(isShareableWith({ ...base, enabled: false }, 'claude')).toBe(false);
    expect(isShareableWith({ ...base, status: 'outdated' }, 'claude')).toBe(false);
    expect(isShareableWith({ ...base, status: 'deleted' }, 'claude')).toBe(false);
  });

  it('returns nothing while paused globally or for that site', () => {
    expect(shareableMemories([base], { ...DEFAULT_SETTINGS, sharingPaused: true }, 'chatgpt')).toEqual([]);
    const sitePaused = { ...DEFAULT_SETTINGS, sitePaused: { chatgpt: false, claude: true, gemini: false } };
    expect(shareableMemories([base], sitePaused, 'claude')).toEqual([]);
    expect(shareableMemories([base], sitePaused, 'chatgpt')).toEqual([base]);
    expect(sharingBlock(sitePaused, 'claude')).toBe('site-pause');
    expect(sharingBlock({ ...sitePaused, sharingPaused: true }, 'claude')).toBe('global-pause');
  });

  it('summarises sharing state', () => {
    expect(sharingSummary(base)).toBe('all');
    expect(sharingSummary({ ...base, permissions: { chatgpt: true, claude: false, gemini: false } })).toBe('some');
    expect(sharingSummary({ ...base, permissions: { chatgpt: false, claude: false, gemini: false } })).toBe('none');
    expect(sharingSummary({ ...base, enabled: false })).toBe('private');
  });
});

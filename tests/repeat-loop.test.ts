import { describe, expect, it } from 'vitest';
import { discover, factOnly, findDuplicateGroups, type DiscoverySource } from '../src/core';
import { createHarness } from './helpers';

// What a user actually saw piling up: ChatGPT's AI-written summary, re-worded
// on every refresh, plus first-person copies of it.
const SUMMARY = [
  'You program VEX robots using PROS and LemLib, and you’ve asked for an explanation of how to tune PID in LemLib. Your robotics programming is the clearest supported area for tailoring technical explanations.',
  'I’ve asked for an explanation of how to tune PID with the LemLib PROS library.',
  'My VEX programming setup uses PROS with LemLib.',
  'Your robotics programming is the clearest supported area for tailoring technical explanations.',
  'I program VEX robots using PROS and LemLib, and I’ve asked for an explanation of how to tune PID in LemLib. My robotics programming is the clearest supported area for tailoring technical explanations.',
  'I program VEX robots with PROS and LemLib, and I’m interested in understanding how LemLib’s PID tuning works.',
];

describe('the repeat loop', () => {
  it('keeps the fact and drops remarks about past chats', () => {
    expect(factOnly('I’ve asked for an explanation of how to tune PID.')).toBeNull();
    expect(factOnly('My robotics programming is the clearest supported area for tailoring technical explanations.')).toBeNull();
    expect(factOnly('I program VEX robots using PROS, and I’ve asked how to tune PID.')).toBe('I program VEX robots using PROS.');
    expect(factOnly('I live in Ohio.')).toBe('I live in Ohio.');
  });

  it('doesn’t offer rewordings of a memory you already have', async () => {
    const h = createHarness();
    await h.service.create({ content: 'I program VEX robots using PROS and LemLib' });
    const sources: DiscoverySource[] = SUMMARY.map((text) => ({ group: 'Memory summary (written by ChatGPT)', text }));
    const found = discover('chatgpt', sources, await h.service.library(), []);
    const texts = found.map((item) => item.text);
    expect(texts.some((text) => /asked|tailoring/i.test(text))).toBe(false);
    // At most the one sentence that adds something (interest in PID tuning), flagged as overlapping.
    expect(found.length).toBeLessThanOrEqual(1);
    for (const item of found) expect(item.conflictsWith).toBe('I program VEX robots using PROS and LemLib');
  });

  it('groups near-identical copies already in a library (the AI catches the rest)', async () => {
    const h = createHarness();
    for (const text of SUMMARY.slice(2)) await h.service.create({ content: text });
    await h.service.create({ content: 'I prefer metric units' });
    const groups = findDuplicateGroups(await h.service.library());
    expect(groups).toHaveLength(1);
    expect(groups[0].length).toBeGreaterThanOrEqual(2);
  });
});

import { createAdapter } from './base';

/**
 * claude.ai — the composer is a ProseMirror (Tiptap) editor inside a fieldset.
 * Not verifiable without signing in, so these selectors lean on the generic
 * fallbacks in base.ts if the markup differs.
 */
export const claudeAdapter = createAdapter({
  id: 'claude',
  composerSelectors: [
    '[data-testid="chat-input"][contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'fieldset div[contenteditable="true"]',
  ],
  anchorSelectors: ['fieldset', '[data-testid="chat-input-container"]'],
  messageSelectors: [
    '[data-testid="user-message"], .font-claude-response, .font-claude-message',
    '[data-test-render-count]',
    'main [data-is-streaming]',
  ],
  insertStrategies: ['paste', 'execCommand', 'beforeinput'],
  inactivePaths: /^\/(login|logout|oauth|magic-link)\b/,
});

import { createAdapter } from './base';

/**
 * chatgpt.com — verified against the live, signed-out site (Nov 2026): the composer is a
 * plain <textarea id="mobile-composer-prompt"> inside a rounded <form>. Earlier
 * builds used a ProseMirror editor with id "prompt-textarea"; both are covered
 * so either variant works.
 */
export const chatgptAdapter = createAdapter({
  id: 'chatgpt',
  composerSelectors: [
    '#prompt-textarea[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'textarea#mobile-composer-prompt',
    'textarea#prompt-textarea',
    'textarea[data-testid="prompt-textarea"]',
    'textarea[placeholder*="ChatGPT" i]',
  ],
  anchorSelectors: ['form[data-type="unified-composer"]', '[data-testid="composer"]', 'form'],
  messageSelectors: ['[data-message-author-role]', 'article[data-testid^="conversation-turn"]', 'main article'],
  insertStrategies: ['paste', 'execCommand', 'beforeinput'],
  inactivePaths: /^\/auth\b/,
});

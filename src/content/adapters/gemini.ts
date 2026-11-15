import { createAdapter } from './base';

/**
 * gemini.google.com — verified against the live, signed-out site (Nov 2026): the composer
 * is a Quill editor inside a <rich-textarea> custom element, boxed by
 * <input-area-v2>. Its Quill ignores synthetic paste events but honours
 * execCommand, so that goes first.
 */
export const geminiAdapter = createAdapter({
  id: 'gemini',
  composerSelectors: [
    'rich-textarea .ql-editor[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
  ],
  anchorSelectors: ['input-area-v2', '.input-area-container', '.text-input-field', 'rich-textarea'],
  messageSelectors: ['user-query, model-response', '.conversation-container', 'message-content'],
  insertStrategies: ['execCommand', 'paste', 'beforeinput'],
});

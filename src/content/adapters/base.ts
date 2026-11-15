import type { SiteId } from '../../core/types';
import { SITES } from '../../shared/sites';
import { insertText, isTextControl, readComposerText, type InsertStrategy } from '../insert';
import type { SiteAdapter } from './types';

export interface AdapterConfig {
  id: SiteId;
  /** Tried in order; the first visible match wins. Most specific first. */
  composerSelectors: string[];
  /** Ancestors of the composer that form its visible box, most specific first. */
  anchorSelectors: string[];
  /** Elements holding individual chat messages. */
  messageSelectors: string[];
  /** Order in which to try rich-text insertion on this site. */
  insertStrategies: InsertStrategy[];
  /** Paths where the control should stay out of the way (e.g. sign-in). */
  inactivePaths?: RegExp;
}

/** Last-resort selectors shared by every site, for when a redesign lands. */
const GENERIC_COMPOSERS = [
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  'textarea',
];

const MAX_MESSAGES = 6;

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 8) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function isOurs(el: Element): boolean {
  return el.closest('omnimemory-root') !== null;
}

/** Walk up to the nearest ancestor that looks like the composer's rounded box. */
function guessAnchor(composer: HTMLElement): HTMLElement {
  const composerWidth = composer.getBoundingClientRect().width;
  let best = composer;
  let current: HTMLElement | null = composer.parentElement;
  for (let depth = 0; current && current !== document.body && depth < 10; depth += 1) {
    const rect = current.getBoundingClientRect();
    // Wrappers with no box of their own (display: contents) are skipped.
    if (rect.width > 0 && rect.height > 0) {
      // Stop before containers that are clearly page-level layout.
      if (rect.width > Math.max(composerWidth * 1.6, composerWidth + 260) || rect.height > 420) break;
      best = current;
      if (parseFloat(getComputedStyle(current).borderTopLeftRadius) >= 12) return current;
    }
    current = current.parentElement;
  }
  return best;
}

/**
 * Builds an adapter from selectors. All three shipped adapters use this; a
 * site that needs special handling can implement SiteAdapter directly.
 */
export function createAdapter(config: AdapterConfig): SiteAdapter {
  const selectors = [...config.composerSelectors, ...GENERIC_COMPOSERS];

  function findComposer(): HTMLElement | null {
    for (const selector of selectors) {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (isOurs(el) || !isVisible(el)) continue;
        if (!isTextControl(el) && !el.isContentEditable) continue;
        return el;
      }
    }
    return null;
  }

  function findAnchor(composer: HTMLElement): HTMLElement {
    for (const selector of config.anchorSelectors) {
      const match = composer.closest<HTMLElement>(selector);
      if (match && isVisible(match)) return match;
    }
    return guessAnchor(composer);
  }

  function readDraft(): string {
    const composer = findComposer();
    return composer ? readComposerText(composer).trim() : '';
  }

  function readConversationTail(maxChars: number): string {
    const parts: string[] = [];
    for (const selector of config.messageSelectors) {
      const nodes = [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => !isOurs(el));
      if (nodes.length === 0) continue;
      for (const node of nodes.slice(-MAX_MESSAGES)) parts.push(node.innerText ?? '');
      break;
    }
    const draft = readDraft();
    // The draft goes last so it always survives the cap.
    const joined = [...parts, draft].join('\n').replace(/\s+/g, ' ').trim();
    return joined.slice(-maxChars);
  }

  async function insert(text: string, probe: string): Promise<boolean> {
    const composer = findComposer();
    if (!composer) return false;
    return insertText(composer, text, {
      probe,
      strategies: config.insertStrategies,
      refind: findComposer,
    });
  }

  return {
    id: config.id,
    label: SITES[config.id].label,
    isActive: () => !config.inactivePaths?.test(window.location.pathname),
    findComposer,
    findAnchor,
    readDraft,
    readConversationTail,
    insert,
  };
}

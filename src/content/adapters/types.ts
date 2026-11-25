import type { SiteId } from '../../core/types';

/**
 * Everything OmniMemory needs to know about one chatbot website. The UI only
 * talks to this interface, so supporting another provider means writing one
 * more adapter — nothing else changes.
 */
export interface SiteAdapter {
  readonly id: SiteId;
  readonly label: string;
  /**
   * Where the Memory button goes: just above the message box's right edge
   * (default), or just below it on sites that put buttons of their own above
   * the box (Gemini's quick replies).
   */
  readonly launcher?: 'above' | 'below';

  /** False on pages that are not a chat (sign-in screens and the like). */
  isActive(): boolean;

  /** The message box, or null if it is not on the page (yet). */
  findComposer(): HTMLElement | null;

  /**
   * The visible box around the composer, used to position the OmniMemory
   * control beside it without touching the site's own DOM.
   */
  findAnchor(composer: HTMLElement): HTMLElement;

  /** What the user has typed so far. */
  readDraft(): string;

  /**
   * The last few visible messages plus the draft, capped at `maxChars`. Used
   * once to rank memories when the panel opens; never stored or sent anywhere
   * but the extension's own service worker.
   */
  readConversationTail(maxChars: number): string;

  /**
   * Put `text` into the composer ahead of the user's draft, without sending.
   * Resolves false when it could not be verified, so the UI can offer Copy.
   */
  insert(text: string, probe: string): Promise<boolean>;
}

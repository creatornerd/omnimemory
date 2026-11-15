/**
 * Putting text into a chatbot's message box.
 *
 * Each site uses a different rich-text editor, and they change without
 * notice, so insertion is a chain of strategies. After each attempt we read
 * the composer back and check the text is really there; if no strategy can be
 * verified the caller falls back to copying to the clipboard.
 *
 * Nothing here ever submits the message.
 */

export type InsertStrategy = 'paste' | 'execCommand' | 'beforeinput';

export function isTextControl(el: Element): el is HTMLTextAreaElement | HTMLInputElement {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

/** Current text of a composer, whatever kind of element it is. */
export function readComposerText(el: HTMLElement): string {
  if (isTextControl(el)) return el.value;
  return (el.innerText ?? el.textContent ?? '').replace(/ /g, ' ');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () => settle(60);

/** <textarea>: set the value through the native setter so React/Vue notice. */
function insertIntoTextControl(el: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const next = el.value.trim() ? `${text}\n\n${el.value}` : `${text}\n\n`;
  if (setter) setter.call(el, next);
  else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
  el.setSelectionRange(next.length, next.length);
}

function placeCaret(el: HTMLElement, where: 'start' | 'end'): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(where === 'start');
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Synthetic paste: ProseMirror- and Lexical-style editors read clipboardData. */
function tryPaste(el: HTMLElement, text: string): boolean {
  try {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    // An editor that handled the paste itself cancels the native one.
    return event.defaultPrevented;
  } catch {
    return false;
  }
}

/** Deprecated but still the most widely honoured way to type into an editor. */
function tryExecCommand(text: string): boolean {
  try {
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

/** Editors built on the beforeinput event (e.g. Slate, newer Lexical). */
function tryBeforeInput(el: HTMLElement, text: string): boolean {
  try {
    const event = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: text,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  } catch {
    return false;
  }
}

export interface InsertOptions {
  /** A short string that must appear once more after insertion than before. */
  probe: string;
  /** Strategy order for rich-text composers. */
  strategies: readonly InsertStrategy[];
  /** Re-resolve the composer: sites sometimes replace the node while typing. */
  refind: () => HTMLElement | null;
}

/**
 * Insert `text` ahead of whatever the user has already typed.
 * Resolves true only when the text is verifiably in the composer.
 */
export async function insertText(el: HTMLElement, text: string, options: InsertOptions): Promise<boolean> {
  const probe = normalize(options.probe);
  const read = () => normalize(readComposerText(options.refind() ?? el));
  const before = countOccurrences(read(), probe);
  const verified = () => countOccurrences(read(), probe) > before;

  if (isTextControl(el)) {
    insertIntoTextControl(el, text);
    await nextFrame();
    return verified();
  }

  if (!el.isContentEditable) return false;
  const hadDraft = normalize(readComposerText(el)).length > 0;
  const payload = `${text}\n\n`;

  for (const strategy of options.strategies) {
    const target = options.refind() ?? el;
    // Editors keep their own copy of the selection. On focus they restore it
    // into the DOM a moment later, and they pick up DOM changes
    // asynchronously — so wait on both sides of moving the caret, or the
    // text lands wherever the caret used to be.
    target.focus();
    await settle(50);
    placeCaret(target, hadDraft ? 'start' : 'end');
    await settle(40);

    if (strategy === 'paste') tryPaste(target, payload);
    else if (strategy === 'execCommand') tryExecCommand(payload);
    else tryBeforeInput(target, payload);

    await nextFrame();
    if (verified()) {
      // Leave the caret after everything so the user can keep typing.
      const current = options.refind() ?? target;
      current.focus();
      placeCaret(current, 'end');
      return true;
    }
  }
  return false;
}

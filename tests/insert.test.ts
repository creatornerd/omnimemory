// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { insertText, readComposerText, type InsertOptions } from '../src/content/insert';

const CONTEXT = '[Context]\n- a fact\n[End of context]';
const PROBE = '[End of context]';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function options(el: HTMLElement): InsertOptions {
  return { probe: PROBE, strategies: ['paste', 'execCommand', 'beforeinput'], refind: () => el };
}

describe('insertText — <textarea> composers', () => {
  it('puts context ahead of the draft and fires an input event', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'My question';
    document.body.appendChild(textarea);
    const onInput = vi.fn();
    textarea.addEventListener('input', onInput);

    const ok = await insertText(textarea, CONTEXT, { ...options(textarea), strategies: ['paste'] });
    expect(ok).toBe(true);
    expect(textarea.value).toBe(`${CONTEXT}\n\nMy question`);
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('works on an empty composer and can be repeated', async () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    expect(await insertText(textarea, CONTEXT, { ...options(textarea), strategies: [] })).toBe(true);
    expect(await insertText(textarea, CONTEXT, { ...options(textarea), strategies: [] })).toBe(true);
    expect(textarea.value.split(PROBE).length - 1).toBe(2);
  });
});

describe('insertText — rich-text composers', () => {
  function editable(): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    // jsdom does not implement isContentEditable.
    Object.defineProperty(el, 'isContentEditable', { value: true });
    document.body.appendChild(el);
    return el;
  }

  it('succeeds when the editor handles a synthetic paste', async () => {
    const el = editable();
    // jsdom has neither ClipboardEvent nor DataTransfer; provide minimal ones.
    class FakeTransfer {
      private data = new Map<string, string>();
      setData(type: string, value: string) {
        this.data.set(type, value);
      }
      getData(type: string) {
        return this.data.get(type) ?? '';
      }
    }
    class FakeClipboardEvent extends Event {
      clipboardData: FakeTransfer;
      constructor(type: string, init: EventInit & { clipboardData: FakeTransfer }) {
        super(type, init);
        this.clipboardData = init.clipboardData;
      }
    }
    vi.stubGlobal('DataTransfer', FakeTransfer);
    vi.stubGlobal('ClipboardEvent', FakeClipboardEvent);
    el.addEventListener('paste', (event) => {
      event.preventDefault(); // what ProseMirror does
      el.textContent = (event as unknown as FakeClipboardEvent).clipboardData.getData('text/plain') + el.textContent;
    });

    const ok = await insertText(el, CONTEXT, { ...options(el), strategies: ['paste'] });
    expect(ok).toBe(true);
    expect(readComposerText(el)).toContain(PROBE);
    vi.unstubAllGlobals();
  });

  it('falls through to the next strategy when one does nothing', async () => {
    const el = editable();
    const execCommand = vi.fn((_command: string, _ui: boolean, value: string) => {
      el.textContent = value;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    const ok = await insertText(el, CONTEXT, options(el)); // paste is ignored by this editor
    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('insertText', false, `${CONTEXT}\n\n`);
  });

  it('reports failure when nothing can be verified, so the UI can offer Copy', async () => {
    const el = editable();
    Object.defineProperty(document, 'execCommand', { value: () => true, configurable: true }); // lies
    expect(await insertText(el, CONTEXT, options(el))).toBe(false);
    expect(readComposerText(el)).toBe('');
  });

  it('refuses elements that are not editable', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(await insertText(div, CONTEXT, options(div))).toBe(false);
  });
});

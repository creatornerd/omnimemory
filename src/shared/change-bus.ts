/**
 * Cross-context "something changed" signal.
 *
 * Memory data lives in IndexedDB, which has no change events across contexts.
 * After every write we bump a revision key in chrome.storage.local; popup,
 * dashboard and content scripts listen for it and re-query. The key holds a
 * timestamp only — never memory content.
 *
 * Outside an extension (the Vite dev server, tests) it falls back to a
 * BroadcastChannel so the same code runs everywhere.
 */

const REVISION_KEY = 'omni:revision';
const CHANNEL_NAME = 'omnimemory:changes';

function hasExtensionStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
}

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

const localListeners = new Set<() => void>();

export function emitChange(): void {
  if (hasExtensionStorage()) {
    // storage.onChanged also fires in the context that made the write.
    void chrome.storage.local.set({ [REVISION_KEY]: Date.now() }).catch(() => {});
  } else {
    // BroadcastChannel skips the sender, so notify this context directly.
    for (const listener of localListeners) listener();
    getChannel()?.postMessage('changed');
  }
}

/** Subscribe to changes made in any context. Returns an unsubscribe function. */
export function onChange(listener: () => void): () => void {
  localListeners.add(listener);

  if (hasExtensionStorage()) {
    const handler = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && REVISION_KEY in changes) listener();
    };
    chrome.storage.onChanged.addListener(handler);
    return () => {
      localListeners.delete(listener);
      chrome.storage.onChanged.removeListener(handler);
    };
  }

  const bus = getChannel();
  const handler = () => listener();
  bus?.addEventListener('message', handler);
  return () => {
    localListeners.delete(listener);
    bus?.removeEventListener('message', handler);
  };
}

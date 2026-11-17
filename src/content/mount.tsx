import { createRoot } from 'react-dom/client';
import type { SiteAdapter } from './adapters';
import { App } from './ui/App';
import styles from './ui/panel.css?inline';

const HOST_TAG = 'omnimemory-root';

/** Events that must not reach the host page's own shortcut/paste handlers. */
const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'input',
  'beforeinput',
  'paste',
  'copy',
  'cut',
  'compositionstart',
  'compositionend',
];

/**
 * Mount the OmniMemory control into the page.
 *
 * The UI lives in a closed shadow root: the site's styles cannot affect it,
 * its styles cannot affect the site, and page scripts cannot read the memory
 * text it displays. Memory content is only ever rendered as text nodes.
 */
export function mount(adapter: SiteAdapter): void {
  if (document.querySelector(HOST_TAG)) return; // already mounted

  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483000;';
  const shadow = host.attachShadow({ mode: 'closed' });

  // A constructed stylesheet is not subject to the page's style CSP; fall
  // back to a <style> element where that API is missing.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = styles;
    shadow.appendChild(style);
  }

  const container = document.createElement('div');
  shadow.appendChild(container);

  for (const type of ISOLATED_EVENTS) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }

  // Sites like ChatGPT send any key press to their own message box unless
  // the focused element looks editable. From outside a closed shadow root the
  // focused element is this host, so while one of our text fields has focus,
  // mark the host editable and the site leaves the keys alone.
  shadow.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      host.setAttribute('contenteditable', 'plaintext-only');
    }
  });
  shadow.addEventListener('focusout', () => host.removeAttribute('contenteditable'));

  document.documentElement.appendChild(host);
  createRoot(container).render(<App adapter={adapter} />);

  // Some single-page apps replace <body>/<html> children wholesale; put the
  // host back if it gets removed.
  const keeper = new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  });
  keeper.observe(document.documentElement, { childList: true });
}

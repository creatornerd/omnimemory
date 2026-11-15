/**
 * Development fixture: a fake chat page with a *real* rich-text editor of the
 * kind each chatbot uses (ProseMirror for ChatGPT and Claude, Quill for
 * Gemini). Lets the on-page panel and insertion strategies be exercised
 * without logging in anywhere:  /dev/fixture.html?site=chatgpt|claude|gemini
 * (add &editor=prosemirror for ChatGPT's older rich-text composer, &theme=light)
 *
 * Never part of the extension build.
 */
import { baseKeymap } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { schema } from 'prosemirror-schema-basic';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import Quill from 'quill';
import { isSiteId, type SiteId } from '../src/core/types';
import { ADAPTERS } from '../src/content/adapters';
import { setDevSite } from '../src/content/bridge';
import { mount } from '../src/content/mount';
import { SITE_LIST } from '../src/shared/sites';

const params = new URLSearchParams(window.location.search);
const requested = params.get('site');
const site: SiteId = isSiteId(requested) ? requested : 'chatgpt';
document.body.className = params.get('theme') === 'light' ? 'light' : 'dark';

const nav = document.getElementById('nav')!;
for (const info of SITE_LIST) {
  const link = document.createElement('a');
  link.href = `?site=${info.id}`;
  link.textContent = `${info.label} fixture`;
  if (info.id === site) link.setAttribute('aria-current', 'page');
  nav.appendChild(link);
}

const MESSAGES: [role: 'user' | 'assistant', text: string][] = [
  ['user', 'Can you help me tune the PID constants for my VEX robot drivetrain?'],
  ['assistant', 'Sure. Which library are you using for motion control, and what is the robot doing wrong right now?'],
  ['user', 'It overshoots on long straight moves. My name is Sam and I go to Lincoln High School.'],
];

const chat = document.getElementById('chat')!;
for (const [role, text] of MESSAGES) {
  let el: HTMLElement;
  if (site === 'chatgpt') {
    el = document.createElement('div');
    el.dataset.messageAuthorRole = role;
  } else if (site === 'claude') {
    el = document.createElement('div');
    if (role === 'user') el.dataset.testid = 'user-message';
    else el.classList.add('font-claude-response');
  } else {
    el = document.createElement(role === 'user' ? 'user-query' : 'model-response');
    el.style.display = 'block';
  }
  el.classList.add('msg', role);
  el.textContent = text;
  chat.appendChild(el);
}

const dock = document.getElementById('dock')!;
if (site === 'gemini') {
  const box = document.createElement('div');
  box.className = 'input-area-container';
  const rich = document.createElement('rich-textarea');
  const editor = document.createElement('div');
  rich.appendChild(editor);
  box.appendChild(rich);
  dock.appendChild(box);
  new Quill(editor, { modules: { toolbar: false }, placeholder: 'Ask Gemini' });
} else if (site === 'chatgpt' && params.get('editor') !== 'prosemirror') {
  // Mirrors the live site: a plain textarea nested in box-less wrappers.
  const box = document.createElement('form');
  const wrapper = document.createElement('div');
  wrapper.style.display = 'contents';
  const textarea = document.createElement('textarea');
  textarea.id = 'mobile-composer-prompt';
  textarea.placeholder = 'Ask ChatGPT';
  textarea.rows = 2;
  textarea.style.cssText =
    'width:100%;border:0;outline:0;resize:none;background:transparent;color:inherit;font:inherit;';
  wrapper.appendChild(textarea);
  box.appendChild(wrapper);
  dock.appendChild(box);
} else {
  const box = document.createElement(site === 'claude' ? 'fieldset' : 'form');
  const editorHost = document.createElement('div');
  box.appendChild(editorHost);
  dock.appendChild(box);
  const view = new EditorView(editorHost, {
    state: EditorState.create({ schema, plugins: [keymap(baseKeymap)] }),
  });
  if (site === 'chatgpt') view.dom.id = 'prompt-textarea';
}

setDevSite(site);
mount(ADAPTERS[site]);

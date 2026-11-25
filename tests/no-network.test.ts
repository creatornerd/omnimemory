import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * OmniMemory has no server of its own. The only network access is chatbot
 * memory sync, which talks to the chatbot site the content script is already
 * on. This guards that: exactly one file may call fetch, it refuses anything
 * that isn't same-origin, and the manifest asks for nothing beyond the three
 * chatbot sites.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('privacy guarantees', () => {
  it('makes network requests from two places only: the chatbot site itself, and Gemini when asked', () => {
    const banned = /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/;
    const allowed = join('src', 'content', 'sync', 'http.ts');
    const gemini = join('src', 'shared', 'gemini.ts');
    const offenders = sourceFiles('src')
      .filter((file) => file !== allowed && file !== gemini)
      .filter((file) => banned.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);

    // The AI client talks to one fixed Google address, with the key in a header.
    const ai = readFileSync(gemini, 'utf8');
    expect(ai.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(ai.match(/https?:\/\/[^'"`\s]+/g)).toEqual(['https://generativelanguage.googleapis.com']);
    expect(ai).toContain("'x-goog-api-key': key");
    expect(ai).not.toMatch(/[?&]key=/);

    const http = readFileSync(allowed, 'utf8');
    expect(http.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(http).toContain("url.origin !== window.location.origin");
    expect(http).not.toMatch(/https?:\/\//);
  });

  it('never sends anything from extension pages or the service worker, except the opt-in AI client', () => {
    const offenders = sourceFiles('src')
      .filter((file) => !file.startsWith(join('src', 'content')))
      .filter((file) => file !== join('src', 'shared', 'gemini.ts'))
      .filter((file) => /siteRequest|\bfetch\s*\(/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
    // Chatbot pages can't reach the AI client or the key.
    const content = sourceFiles(join('src', 'content')).filter((file) => {
      let text = readFileSync(file, 'utf8');
      // The Vite dev fixture's in-page router branch is stripped from builds.
      if (file.endsWith('bridge.ts')) text = text.replace(/else if \(import\.meta\.env\.DEV\) \{[\s\S]*?\n {2}\} else/, '');
      return /shared\/gemini|core\/ai'|getAssistant|getAiKey|getSecret/.test(text);
    });
    expect(content).toEqual([]);
    expect(readFileSync(join('src', 'background', 'router.ts'), 'utf8')).not.toMatch(/getAiKey|getSecret/);
  });

  it('never renders memory text as HTML', () => {
    const banned = /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/;
    const offenders = sourceFiles('src').filter((file) => banned.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('requests minimal permissions and blocks outbound connections', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
    expect(manifest.permissions.sort()).toEqual(['contextMenus', 'storage']);
    // Only the three chatbot sites (already covered by the content scripts).
    expect(manifest.host_permissions.sort()).toEqual([
      'https://chatgpt.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
    ]);
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
    expect(manifest.web_accessible_resources).toBeUndefined();
    // Extension pages may connect only to the Gemini API (used only when the
    // user turns the AI assistant on).
    expect(manifest.content_security_policy.extension_pages).toContain(
      'connect-src https://generativelanguage.googleapis.com;',
    );
    expect(manifest.content_scripts[0].matches.sort()).toEqual([
      'https://chatgpt.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
    ]);
  });
});

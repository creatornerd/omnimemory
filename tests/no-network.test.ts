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
  it('makes network requests from one place only, and only to the chatbot site itself', () => {
    const banned = /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/;
    const allowed = join('src', 'content', 'sync', 'http.ts');
    const offenders = sourceFiles('src')
      .filter((file) => file !== allowed)
      .filter((file) => banned.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);

    const http = readFileSync(allowed, 'utf8');
    expect(http.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(http).toContain("url.origin !== window.location.origin");
    expect(http).not.toMatch(/https?:\/\//);
  });

  it('never sends anything from extension pages or the service worker', () => {
    const offenders = sourceFiles('src')
      .filter((file) => !file.startsWith(join('src', 'content')))
      .filter((file) => /siteRequest|\bfetch\s*\(/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
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
    expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'");
    expect(manifest.content_scripts[0].matches.sort()).toEqual([
      'https://chatgpt.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
    ]);
  });
});

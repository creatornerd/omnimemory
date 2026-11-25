/**
 * Production build → dist/ (load this folder in chrome://extensions).
 * With --firefox → dist-firefox/ (load it from about:debugging, or submit it
 * to addons.mozilla.org). Same code; only the manifest differs.
 *
 * Three passes, because each part of an extension needs a different shape:
 *   1. popup.html + dashboard.html  → normal multi-page app build
 *   2. background service worker    → one ES module file
 *   3. content script               → one classic (IIFE) file, CSS inlined
 */
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const firefox = process.argv.includes('--firefox');
const outDir = resolve(root, firefox ? 'dist-firefox' : 'dist');
const target = firefox ? 'firefox128' : 'chrome120';
const shared = { root, configFile: false, logLevel: 'warn', base: './' };

await build({
  ...shared,
  plugins: [react(), tailwindcss()],
  build: {
    outDir,
    emptyOutDir: true,
    target,
    // Chrome supports modulepreload natively; the polyfill would add a fetch().
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { popup: resolve(root, 'popup.html'), dashboard: resolve(root, 'dashboard.html') },
    },
  },
});

const single = (entry, fileName, format) => ({
  outDir,
  emptyOutDir: false,
  copyPublicDir: false,
  target,
  rollupOptions: {
    input: resolve(root, entry),
    output: { format, entryFileNames: fileName, codeSplitting: false },
  },
});

await build({ ...shared, build: single('src/background/index.ts', 'background.js', 'es') });
await build({ ...shared, plugins: [react()], build: single('src/content/index.tsx', 'content.js', 'iife') });

// Fail loudly if the manifest points at anything that was not built.
const manifest = JSON.parse(readFileSync(resolve(outDir, 'manifest.json'), 'utf8'));

if (firefox) {
  // Firefox runs MV3 backgrounds as event pages, not service workers, and
  // needs an add-on id. Everything else in the manifest is shared.
  const { service_worker: worker, type } = manifest.background;
  manifest.background = { scripts: [worker], type };
  delete manifest.minimum_chrome_version;
  manifest.browser_specific_settings = {
    gecko: {
      id: 'omnimemory@creatornerd.github.io',
      strict_min_version: '128.0',
      data_collection_permissions: { required: ['none'] },
    },
  };
  writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

const referenced = [
  ...(manifest.background.scripts ?? [manifest.background.service_worker]),
  manifest.action.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((entry) => entry.js),
];
const missing = referenced.filter((file) => !existsSync(resolve(outDir, file)));
if (missing.length > 0) {
  console.error(`Build incomplete — manifest references missing files: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(
  firefox
    ? `\nBuilt Firefox add-on → ${outDir}\nLoad it from about:debugging → This Firefox → Load Temporary Add-on (pick manifest.json).`
    : `\nBuilt extension → ${outDir}\nLoad it from chrome://extensions → Developer mode → Load unpacked.`,
);

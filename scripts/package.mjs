/**
 * Zips the built extension for the stores:
 *   release/omnimemory-chrome-<version>.zip   → Chrome Web Store (from dist/)
 *   release/omnimemory-firefox-<version>.zip  → Firefox Add-ons (from dist-firefox/)
 *
 *   npm run build && npm run build:firefox && npm run package
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'release');
mkdirSync(out, { recursive: true });

for (const [name, dir] of [
  ['chrome', 'dist'],
  ['firefox', 'dist-firefox'],
]) {
  const folder = resolve(root, dir);
  if (!existsSync(resolve(folder, 'manifest.json'))) {
    console.warn(`Skipping ${name}: ${dir}/ isn't built yet.`);
    continue;
  }
  const { version } = JSON.parse(readFileSync(resolve(folder, 'manifest.json'), 'utf8'));
  const zip = resolve(out, `omnimemory-${name}-${version}.zip`);
  rmSync(zip, { force: true });
  // Zip the folder's contents (manifest.json at the top level), without macOS clutter.
  execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '.DS_Store', '-x', '*/.DS_Store'], { cwd: folder });
  console.log(`Packed ${zip}`);
}

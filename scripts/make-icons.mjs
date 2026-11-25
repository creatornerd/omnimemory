/**
 * Renders the extension icons (public/icons/icon{16,32,48,128}.png) from the
 * same geometry as the in-app logo. Dependency-free: shapes are rasterised
 * with signed-distance functions and written with a minimal PNG encoder.
 *
 *   npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
const INK = [27, 27, 25];
const PAPER = [250, 250, 248];
const BLUE = [59, 91, 219];

// Geometry in the logo's 24×24 design space.
const roundedSquare = (x, y) => {
  const r = 6.5;
  const dx = Math.abs(x - 12) - (12 - r);
  const dy = Math.abs(y - 12) - (12 - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};
// Two overlapping rings; the lens where they overlap is filled blue.
const R = 5.2;
const leftDisc = (x, y) => Math.hypot(x - 9.2, y - 12) - R;
const rightDisc = (x, y) => Math.hypot(x - 14.8, y - 12) - R;
const lens = (x, y) => Math.max(leftDisc(x, y), rightDisc(x, y));
const ringWidth = (size) => (size <= 16 ? 1.9 : size <= 32 ? 1.7 : 1.6) / 2;
const ring = (x, y, size) =>
  Math.min(Math.abs(leftDisc(x, y)), Math.abs(rightDisc(x, y))) - ringWidth(size);

function render(size) {
  const scale = 24 / size;
  const coverage = (distance) => Math.min(1, Math.max(0, 0.5 - distance / scale));
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) * scale;
      const y = (py + 0.5) * scale;
      const body = coverage(roundedSquare(x, y));
      const fill = coverage(lens(x, y));
      const mark = coverage(ring(x, y, size));
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c += 1) {
        const base = INK[c] + (BLUE[c] - INK[c]) * fill;
        pixels[i + c] = Math.round(base + (PAPER[c] - base) * mark);
      }
      pixels[i + 3] = Math.round(body * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outDir, `icon${size}.png`), png(size, render(size)));
}
console.log(`Icons written to ${outDir}`);

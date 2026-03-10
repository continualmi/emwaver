#!/usr/bin/env node
/**
 * Generate Dock-friendly Apple AppIcon PNGs (macOS/iOS appiconset) by:
 *  - scaling artwork down (padding) on same-size transparent canvas
 *  - applying rounded-corner alpha mask to the *resized artwork* (not just canvas)
 *
 * Intended to be deterministic and keep `orig/` untouched.
 *
 * Usage:
 *   ICON_SCALE=0.84 ICON_RADIUS=200 node scripts/make_apple_appiconset.mjs <appiconset-dir>
 *
 * Expects:
 *   <appiconset-dir>/orig/*.png   (source-of-truth per-size)
 * Writes:
 *   <appiconset-dir>/*.png        (overwrites)
 */

import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  throw new Error('Missing dependency: sharp. Install it in a Node workspace before running this script.');
}

const SCALE = Number(process.env.ICON_SCALE ?? '0.84');
const RADIUS_1024 = Number(process.env.ICON_RADIUS ?? '200');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('missing <appiconset-dir>');

  const appiconsetDir = path.resolve(process.cwd(), dir);
  const origDir = path.join(appiconsetDir, 'orig');

  const origEntries = await fs.readdir(origDir);
  const origPngs = origEntries.filter((f) => f.toLowerCase().endsWith('.png'));
  must(origPngs.length > 0, `no PNGs found in ${origDir}`);

  for (const filename of origPngs) {
    const src = path.join(origDir, filename);
    const dst = path.join(appiconsetDir, filename);

    const meta = await sharp(src).metadata();
    const size = meta.width;
    must(meta.width && meta.height && meta.width === meta.height, `not square: ${src}`);

    const canvas = size;
    const target = Math.round(canvas * SCALE);
    const inset = Math.round((canvas - target) / 2);

    // Corner radius scaled from 1024 reference.
    const rCanvas = Math.max(0, Math.min(Math.round(RADIUS_1024 * (canvas / 1024)), Math.floor(canvas / 2)));
    // Apply rounding to the resized artwork.
    const rArt = Math.max(0, Math.min(Math.round(rCanvas * (target / canvas)), Math.floor(target / 2)));

    const resizedBuf = await sharp(src)
      .resize(target, target, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();

    const maskSvgArt = `
      <svg width="${target}" height="${target}" viewBox="0 0 ${target} ${target}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${target}" height="${target}" rx="${rArt}" ry="${rArt}" fill="white"/>
      </svg>
    `;

    const roundedResizedBuf = await sharp(resizedBuf)
      .composite([{ input: Buffer.from(maskSvgArt), blend: 'dest-in' }])
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: canvas,
        height: canvas,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([{ input: roundedResizedBuf, left: inset, top: inset }])
      .png()
      .toFile(dst);

    process.stdout.write(`ok ${filename}  canvas=${canvas} target=${target} inset=${inset} rCanvas=${rCanvas} rArt=${rArt}\n`);
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

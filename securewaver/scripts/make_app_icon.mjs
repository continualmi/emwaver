import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tunables
const SCALE = Number(process.env.ICON_SCALE ?? '0.84'); // artwork scale inside the canvas
const CANVAS = 1024;

// macOS does not reliably apply a mask to arbitrary app icons; provide rounded corners in the artwork.
// Default chosen to match the modern "squircle" feel; tweak if needed.
const RADIUS = Number(process.env.ICON_RADIUS ?? '200'); // corner radius at 1024px canvas

// Inputs/outputs (relative to securewaver/)
const SRC = path.resolve(__dirname, '../src-tauri/icons/icon-art-512.png');
const OUT = path.resolve(__dirname, '../src-tauri/app-icon.png');

async function main() {
  const meta = await sharp(SRC).metadata();
  if (!meta.width || !meta.height) throw new Error(`Could not read dimensions for ${SRC}`);
  if (meta.width !== meta.height) throw new Error(`Source must be square. Got ${meta.width}x${meta.height}`);

  const target = Math.round(CANVAS * SCALE);
  const inset = Math.round((CANVAS - target) / 2);

  // Resize artwork to target size.
  const resizedBuf = await sharp(SRC)
    .resize(target, target, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  // Apply rounded corners to the *artwork* itself (this is what shows up in Finder previews).
  const r = Math.max(0, Math.min(RADIUS, CANVAS / 2));
  const rArt = Math.round(r * (target / CANVAS));
  const maskSvgArt = `
    <svg width="${target}" height="${target}" viewBox="0 0 ${target} ${target}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${target}" height="${target}" rx="${rArt}" ry="${rArt}" fill="white"/>
    </svg>
  `;

  const roundedResizedBuf = await sharp(resizedBuf)
    .composite([{ input: Buffer.from(maskSvgArt), blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Compose on transparent 1024x1024 canvas.
  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: roundedResizedBuf, left: inset, top: inset }])
    .png()
    .toFile(OUT);

  console.log(`Wrote ${OUT} (canvas=${CANVAS}, scale=${SCALE}, target=${target}, radius=${r} (art radius ${rArt}))`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

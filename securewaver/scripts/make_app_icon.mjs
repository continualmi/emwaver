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

  // Resize artwork to target size, then place it centered on a transparent 1024x1024 canvas.
  const resized = await sharp(SRC)
    .resize(target, target, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  // Compose on transparent canvas.
  const baseBuf = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resized, left: inset, top: inset }])
    .png()
    .toBuffer();

  // Apply rounded-rect alpha mask.
  const r = Math.max(0, Math.min(RADIUS, CANVAS / 2));
  const maskSvg = `
    <svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" rx="${r}" ry="${r}" fill="white"/>
    </svg>
  `;

  await sharp(baseBuf)
    .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
    .png()
    .toFile(OUT);

  console.log(`Wrote ${OUT} (canvas=${CANVAS}, scale=${SCALE}, target=${target}, radius=${r})`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

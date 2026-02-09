import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tunables
const SCALE = Number(process.env.ICON_SCALE ?? '0.84'); // artwork scale inside the canvas
const CANVAS = 1024;

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

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resized, left: inset, top: inset }])
    .png()
    .toFile(OUT);

  console.log(`Wrote ${OUT} (canvas=${CANVAS}, scale=${SCALE}, target=${target})`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

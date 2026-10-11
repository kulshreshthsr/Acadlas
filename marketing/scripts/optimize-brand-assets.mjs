// Generates web-ready derivatives of the supplied brand files.
//
// Inputs (never modified):
//   public/branding-acadlas.png   wordmark
//   public/favicon-acadlas.png    favicon artwork
//
// Outputs:
//   src/assets/brand/acadlas-wordmark.png         upright, trimmed wordmark (rendered through astro:assets)
//   src/assets/brand/acadlas-wordmark-light.png   the same wordmark in white on transparency, for navy surfaces
//   public/favicon-32x32.png, favicon-192x192.png, apple-touch-icon.png
//
// What this does to the pixels, and nothing else:
//   - Wordmark: the supplied file stores its pixels rotated 90° clockwise (no EXIF flag),
//     so it is rotated 90° counter-clockwise to read upright.
//   - Both: near-white background noise (every channel >= WHITE_POINT) is snapped to pure
//     white so the artwork sits seamlessly on white surfaces. Ink pixels are untouched.
//   - Both: empty margin around the artwork is trimmed. The favicon is then padded back
//     out to a square so browsers do not stretch it.
//
// Re-run with `npm run brand:optimize` after the founder supplies a corrected export.

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WHITE_POINT = 236;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function snapBackgroundToWhite(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    if (Math.min(data[i], data[i + 1], data[i + 2]) >= WHITE_POINT) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
    }
  }
  return sharp(data, { raw: info });
}

async function buildWordmark() {
  const cleaned = await snapBackgroundToWhite(resolve(root, 'public/branding-acadlas.png'));
  const upright = await cleaned.rotate(270).png().toBuffer();
  const out = resolve(root, 'src/assets/brand/acadlas-wordmark.png');
  await mkdir(dirname(out), { recursive: true });
  const info = await sharp(upright)
    .trim({ background: '#ffffff', threshold: 25 })
    .resize({ width: 960, kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wordmark  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB  -> src/assets/brand/acadlas-wordmark.png`);
}

// White-on-transparent copy of the wordmark for dark surfaces: each pixel's darkness becomes its opacity.
async function buildLightWordmark() {
  const src = resolve(root, 'src/assets/brand/acadlas-wordmark.png');
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const INK = 40; // luminance of the navy ink, which becomes fully opaque
  for (let i = 0; i < data.length; i += info.channels) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const coverage = Math.min(1, Math.max(0, (255 - lum) / (255 - INK)));
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(coverage * data[i + 3]);
  }
  const out = resolve(root, 'src/assets/brand/acadlas-wordmark-light.png');
  const written = await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(out);
  console.log(`wordmark  ${written.width}x${written.height}  ${(written.size / 1024).toFixed(0)} KB  -> src/assets/brand/acadlas-wordmark-light.png`);
}

async function buildFavicons() {
  const cleaned = await snapBackgroundToWhite(resolve(root, 'public/favicon-acadlas.png'));
  const trimmed = await cleaned
    .png()
    .toBuffer()
    .then((buf) => sharp(buf).trim({ background: '#ffffff', threshold: 25 }).toBuffer({ resolveWithObject: true }));

  const { width, height } = trimmed.info;
  const side = Math.round(Math.max(width, height) * 1.1);
  const padX = side - width;
  const padY = side - height;
  const squared = await sharp(trimmed.data)
    .extend({
      left: Math.floor(padX / 2),
      right: Math.ceil(padX / 2),
      top: Math.floor(padY / 2),
      bottom: Math.ceil(padY / 2),
      background: WHITE,
    })
    .png()
    .toBuffer();

  const targets = [
    ['favicon-32x32.png', 32],
    ['favicon-192x192.png', 192],
    ['apple-touch-icon.png', 180],
  ];
  for (const [name, size] of targets) {
    const info = await sharp(squared)
      .resize({ width: size, height: size, kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toFile(resolve(root, 'public', name));
    console.log(`favicon   ${info.width}x${info.height}  ${(info.size / 1024).toFixed(1)} KB  -> public/${name}`);
  }
}

await buildWordmark();
await buildLightWordmark();
await buildFavicons();

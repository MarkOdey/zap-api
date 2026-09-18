import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

import find from './find.js';
import record from './record.js';
import connect from './connect.js';
import { encodeDerived } from '../utils/vision.js';

/**
 * Still-to-still adjustments, in contrast to `effect` which turns stills into
 * motion and always produces video. These stay images, so they can be fed back
 * into `isolate`, `compose`, `montage` or `render`.
 *
 * Each entry receives the sharp pipeline and the caller's options, and returns
 * the pipeline with its operation applied.
 */
const ADJUSTMENTS = {
  blur: (img, { sigma = 8 }) => img.blur(clamp(Number(sigma) || 8, 0.3, 100)),

  sharpen: (img, { sigma = 2 }) => img.sharpen({ sigma: clamp(Number(sigma) || 2, 0.3, 10) }),

  greyscale: (img) => img.greyscale(),

  negate: (img) => img.negate({ alpha: false }),

  /** Brightness, saturation and hue in one pass. Hue is in degrees. */
  colour: (img, { brightness = 1, saturation = 1.4, hue = 0 }) => img.modulate({
    brightness: clamp(Number(brightness) || 1, 0.1, 3),
    saturation: clamp(Number(saturation) || 1, 0, 5),
    hue: Number(hue) || 0,
  }),

  /** Push everything toward one colour. */
  tint: (img, { colour = '#ff7b00' }) => img.tint(colour),

  /** Lift or crush the midtones. */
  gamma: (img, { value = 2.2 }) => img.gamma(clamp(Number(value) || 2.2, 1, 3)),

  /** Flatten detail into blocks of colour. */
  posterize: (img, { levels = 4 }) => {
    const n = clamp(Math.round(Number(levels) || 4), 2, 16);
    // Quantising to a small palette is the cheap route to a posterised look.
    return img.png({ palette: true, colours: Math.max(2, n * n) });
  },

  /** Soften into a dream: blur a copy over the original. */
  bloom: (img, { sigma = 12 }) => img.blur(clamp(Number(sigma) || 12, 1, 40)).modulate({ brightness: 1.15 }),

  flip: (img) => img.flip(),
  flop: (img) => img.flop(),

  rotate: (img, { degrees = 90 }) => img.rotate(Number(degrees) || 90, { background: '#00000000' }),

  /** Square crop from the centre, useful before compositing. */
  square: (img) => img.resize({ width: 1024, height: 1024, fit: 'cover', position: 'centre' }),
};

export const ADJUSTMENT_NAMES = Object.keys(ADJUSTMENTS);

/**
 * Apply a still-image adjustment, saving the result as a new image document.
 *
 * @param {object} params
 * @param {string} params.key      Image document to work from
 * @param {string} params.adjust   One of ADJUSTMENT_NAMES
 */
async function adjust({ key, adjust: name, ...options } = {}) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('adjust: key must be an image document key');
  if (!name) throw new Error(`adjust: adjust is required — one of ${ADJUSTMENT_NAMES.join(', ')}`);

  const apply = ADJUSTMENTS[name];
  if (!apply) throw new Error(`adjust: unknown adjustment "${name}" — try ${ADJUSTMENT_NAMES.join(', ')}`);

  const doc = await find(key);
  if (!doc) throw new Error(`adjust: no document for key ${key}`);
  if (!doc.type?.includes('image')) {
    throw new Error(`adjust: ${key} is ${doc.type || 'untyped'}, expected an image`);
  }

  // rotate() applies EXIF orientation first, so the result matches what is seen.
  const base = sharp(doc.source, { failOn: 'none' }).rotate();
  const adjusted = await apply(base, options).toBuffer();
  const out = await encodeDerived(adjusted);

  const dataDir = process.env.DATA_DIR || './data';
  const stem = path.basename(doc.source, path.extname(doc.source));
  const outPath = path.join(dataDir, `${stem}.${name}.${out.ext}`);
  await fs.writeFile(outPath, out.buffer);

  await record({
    key: outPath,
    source: outPath,
    name: path.basename(outPath),
    type: out.mime,
    generator: 'adjust',
    derivedFrom: [doc.key],
    label: name,
  });
  await connect({ from: doc.key, to: outPath, type: 'derivative', weight: 0.8 });

  console.log(`adjust: ${name} on ${doc.key} → ${outPath} (${out.width}x${out.height}, ${(out.buffer.length / 1024).toFixed(0)}KB)`);
  return { key: outPath, width: out.width, height: out.height, bytes: out.buffer.length };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default adjust;

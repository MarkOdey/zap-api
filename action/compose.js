import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

import find from './find.js';
import record from './record.js';
import connect from './connect.js';
import isolate from './isolate.js';
import { isDerivative } from '../model/document.js';
import { encodeDerived } from '../utils/vision.js';

/** Stop generated images being fed back in indefinitely. */
const MAX_DERIVATION_DEPTH = Number(process.env.MAX_DERIVATION_DEPTH || 3);

/**
 * Mix a shape isolated from one image into another image.
 *
 * If `from` is not already a cutout, it is isolated first, so a single call can
 * go from two indexed photos to a new composite.
 *
 * @param {object}  params
 * @param {string}  params.from      Key of the source image (or an existing cutout)
 * @param {string}  params.to        Key of the target image to paste into
 * @param {string} [params.label]    Which segment to isolate from `from`
 * @param {number} [params.scale]    Cutout height as a fraction of target height (default 0.5)
 * @param {number} [params.x]        Left position 0–1 of the target width (default centred)
 * @param {number} [params.y]        Top position 0–1 of the target height (default 0.5)
 * @param {number} [params.opacity]  0–1 (default 1)
 */
async function compose({ from, to, label, scale = 0.5, x, y = 0.5, opacity = 1 } = {}) {
  if (!from || !to) throw new Error('compose: both from and to are required');

  const target = await find(to);
  if (!target) throw new Error(`compose: no document for key ${to}`);
  if (!target.type?.includes('image')) {
    throw new Error(`compose: target ${to} is ${target.type || 'untyped'}, expected an image`);
  }

  const depth = (Array.isArray(target.derivedFrom) ? target.derivedFrom.length : 0);
  if (depth >= MAX_DERIVATION_DEPTH) {
    throw new Error(`compose: ${to} is already ${depth} generations deep, refusing to go further`);
  }

  // Resolve the source to a cutout, isolating it first if it is a plain photo.
  let cutoutKey = from;
  let sourceDoc = await find(from);
  if (!sourceDoc) throw new Error(`compose: no document for key ${from}`);

  if (!isDerivative(sourceDoc) || sourceDoc.generator !== 'isolate') {
    const { cutouts } = await isolate({ key: from, label });
    if (cutouts.length === 0) throw new Error(`compose: nothing could be isolated from ${from}`);
    cutoutKey = cutouts[0];
    sourceDoc = await find(cutoutKey);
  }

  const targetImage = sharp(target.source, { failOn: 'none' }).rotate();
  const targetMeta = await sharp(target.source).metadata();
  const swapped = targetMeta.orientation >= 5 && targetMeta.orientation <= 8;
  const tWidth = swapped ? targetMeta.height : targetMeta.width;
  const tHeight = swapped ? targetMeta.width : targetMeta.height;

  // Scale the cutout relative to the target, preserving its aspect ratio.
  const overlayHeight = Math.max(1, Math.round(tHeight * scale));
  let overlay = await sharp(sourceDoc.source)
    .resize({ height: overlayHeight, fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .png()
    .toBuffer();

  if (opacity < 1) {
    const meta = await sharp(overlay).metadata();
    const alpha = await sharp(overlay).extractChannel('alpha').raw().toBuffer();
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(alpha[i] * opacity);
    overlay = await sharp(await sharp(overlay).removeAlpha().raw().toBuffer(),
      { raw: { width: meta.width, height: meta.height, channels: 3 } })
      .joinChannel(alpha, { raw: { width: meta.width, height: meta.height, channels: 1 } })
      .png()
      .toBuffer();
  }

  const overlayMeta = await sharp(overlay).metadata();
  const left = clamp(Math.round((x ?? 0.5) * tWidth - overlayMeta.width / 2), 0, Math.max(0, tWidth - overlayMeta.width));
  const top = clamp(Math.round(y * tHeight - overlayMeta.height / 2), 0, Math.max(0, tHeight - overlayMeta.height));

  const dataDir = process.env.DATA_DIR || './data';
  const targetBase = path.basename(target.source, path.extname(target.source));
  const sourceBase = path.basename(sourceDoc.source, path.extname(sourceDoc.source));
  const composed = await targetImage
    .composite([{ input: overlay, left, top }])
    .png()
    .toBuffer();

  const out = await encodeDerived(composed);
  const outPath = path.join(
    dataDir,
    `${targetBase}.mix-${sourceBase}.${out.ext}`.replace(/\.cut-/g, '-'),
  );
  await fs.writeFile(outPath, out.buffer);

  await record({
    key: outPath,
    source: outPath,
    name: path.basename(outPath),
    type: out.mime,
    generator: 'compose',
    derivedFrom: [sourceDoc.key, target.key],
  });

  await connect({ from: target.key, to: outPath, type: 'derivative', weight: 0.8 });
  await connect({ from: sourceDoc.key, to: outPath, type: 'derivative', weight: 0.8 });

  console.log(`compose: ${sourceDoc.key} + ${target.key} → ${outPath} at ${left},${top}`);
  return { key: outPath, left, top, width: overlayMeta.width, height: overlayMeta.height };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default compose;

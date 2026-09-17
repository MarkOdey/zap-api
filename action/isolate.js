import path from 'path';
import sharp from 'sharp';

import find from './find.js';
import record from './record.js';
import connect from './connect.js';
import { getSegmenter, loadForInference, cutOut, maskCoverage } from '../utils/vision.js';

/** Panoptic labels that describe backdrop rather than a subject worth cutting out. */
const BACKDROP = /^(wall|sky|floor|ceiling|ground|road|pavement|rug|dirt|sand|water|sea|grass|tree|LABEL_)/i;

/** Reject masks that are essentially empty or essentially the whole frame. */
const MIN_COVERAGE = 0.005;
const MAX_COVERAGE = 0.95;

/**
 * Cut a shape out of an indexed image and store it as a new transparent PNG.
 *
 * @param {object}  params
 * @param {string}  params.key      Document key of the source image
 * @param {string} [params.label]   Prefer a segment with this label (e.g. "person")
 * @param {boolean}[params.all]     Cut out every acceptable segment, not just the best
 * @returns {Promise<{cutouts: string[], segments: object[]}>}
 */
async function isolate({ key, label, all = false } = {}) {
  if (!key) throw new Error('isolate: key is required');

  const doc = await find(key);
  if (!doc) throw new Error(`isolate: no document for key ${key}`);
  if (!doc.type?.includes('image')) {
    throw new Error(`isolate: ${key} is ${doc.type || 'untyped'}, expected an image`);
  }

  const { image, width, height, raw } = await loadForInference(doc.source);

  const segmenter = await getSegmenter();
  const found = await segmenter(raw);

  const usable = found
    .map(s => ({ ...s, coverage: maskCoverage(s.mask) }))
    .filter(s => s.coverage >= MIN_COVERAGE && s.coverage <= MAX_COVERAGE)
    .filter(s => !BACKDROP.test(s.label ?? ''))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (usable.length === 0) {
    console.warn('isolate: no usable segment in', key);
    return { cutouts: [], segments: [] };
  }

  const chosen = label
    ? usable.filter(s => s.label?.toLowerCase().includes(label.toLowerCase()))
    : (all ? usable : [usable[0]]);

  if (chosen.length === 0) {
    console.warn(`isolate: no segment labelled "${label}" in ${key} — saw:`,
      usable.map(s => s.label).join(', '));
    return { cutouts: [], segments: usable.map(summarize) };
  }

  const dataDir = process.env.DATA_DIR || './data';
  const base = path.basename(doc.source, path.extname(doc.source));
  const cutouts = [];

  for (const [index, segment] of chosen.entries()) {
    const cut = await cutOut(image, segment.mask, width, height);

    // trim() drops the fully transparent border left by the mask
    const trimmed = await sharp(cut).trim({ threshold: 0 }).png().toBuffer();
    const meta = await sharp(trimmed).metadata();

    // A panoptic result can hold several segments with the same label (two people,
    // say), so the index keeps them from overwriting each other.
    const safeLabel = (segment.label ?? 'segment').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const suffix = chosen.length > 1 ? `-${index}` : '';
    const outPath = path.join(dataDir, `${base}.cut-${safeLabel}${suffix}.png`);
    await sharp(trimmed).toFile(outPath);

    await record({
      key: outPath,
      source: outPath,
      name: path.basename(outPath),
      type: 'image/png',
      generator: 'isolate',
      derivedFrom: [doc.key],
      label: segment.label,
      score: segment.score ?? null,
    });

    await connect({ from: doc.key, to: outPath, type: 'derivative', weight: 0.8 });

    console.log(`isolate: ${segment.label} → ${outPath} (${meta.width}x${meta.height})`);
    cutouts.push(outPath);
  }

  return { cutouts, segments: chosen.map(summarize) };
}

const summarize = s => ({
  label: s.label,
  score: s.score ?? null,
  coverage: Number(s.coverage?.toFixed(4) ?? 0),
});

export default isolate;

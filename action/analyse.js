import MongoConnexion from '../utils/MongoConnexion.js';
import find from './find.js';
import { getSegmenter, loadForInference, maskCoverage } from '../utils/vision.js';

/** Ignore a region smaller than this share of the frame. */
const MIN_COVERAGE = Number(process.env.ANALYSE_MIN_COVERAGE || 0.02);

/** Most images resolve to a handful of things worth naming. */
const MAX_LABELS = Number(process.env.ANALYSE_MAX_LABELS || 8);

/**
 * Panoptic classes the model has no word for. They are real regions, but
 * "LABEL_187" says nothing and must not become a subject documents are linked by.
 */
const UNNAMED = /^LABEL_\d+$/i;

/**
 * Record what is in an image, in words.
 *
 * The segmentation model already identifies every region; `isolate` computes all
 * of it and keeps only the one it cuts out. This keeps the labels instead, so a
 * photograph knows it contains a person, a road and a bicycle without anything
 * being cut from it.
 *
 * @param {object|string} params
 * @param {string}        params.key
 * @returns {Promise<{key: string, labels: string[]}>}
 */
async function analyse(params) {
  const key = typeof params === 'string' ? params : params?.key;
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('analyse: key must be an image document key');
  }

  const doc = await find(key);
  if (!doc) throw new Error(`analyse: no document for key ${key}`);
  if (!doc.type?.includes('image')) {
    throw new Error(`analyse: ${key} is ${doc.type || 'untyped'}, expected an image`);
  }

  const { raw } = await loadForInference(doc.source);
  const segmenter = await getSegmenter();
  const found = await segmenter(raw);

  const seen = new Map();
  for (const segment of found) {
    const label = segment.label ?? '';
    if (!label || UNNAMED.test(label)) continue;

    const coverage = maskCoverage(segment.mask);
    if (coverage < MIN_COVERAGE) continue;

    // The same thing can appear as several regions — two people, three cars.
    const existing = seen.get(label);
    if (existing) {
      existing.coverage += coverage;
      existing.count++;
      existing.score = Math.max(existing.score, segment.score ?? 0);
    } else {
      seen.set(label, { label, coverage, count: 1, score: segment.score ?? 0 });
    }
  }

  const subjects = [...seen.values()]
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, MAX_LABELS)
    .map(s => ({ ...s, coverage: +s.coverage.toFixed(4) }));

  const labels = subjects.map(s => s.label);

  const db = await MongoConnexion.db();
  await db.collection('data').updateOne(
    { key },
    { $set: { labels, subjects, analysedAt: new Date() } },
  );

  console.log(`analyse: ${key} — ${labels.length ? labels.join(', ') : 'nothing nameable'}`);
  return { key, labels, subjects };
}

export default analyse;

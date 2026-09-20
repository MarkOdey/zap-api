import MongoConnexion from './MongoConnexion.js';

/**
 * The library's lexical vocabulary, used only to *steer* the mission agent — it is
 * not the source of prompts. Each term carries how often it appears (frequency)
 * and how present it already is in the graph (density); missions lean toward
 * *sparse* terms so answers fill gaps.
 */

/** Common words that are never useful mission terms. */
const STOPish = new Set(['thing', 'object', 'background', 'other', 'stuff']);

/**
 * Tally terms from a set of documents. Pure, so it can be tested without a DB.
 * Reads `subjects` (with coverage) first, falling back to `labels`.
 * @param {object[]} docs
 * @returns {{label:string, freq:number, coverage:number}[]}
 */
export function tally(docs) {
  const seen = new Map();
  for (const doc of docs) {
    const subjects = Array.isArray(doc?.subjects) ? doc.subjects : null;
    const labels = subjects
      ? subjects.map(s => ({ label: s.label, coverage: s.coverage ?? 0 }))
      : (Array.isArray(doc?.labels) ? doc.labels.map(l => ({ label: l, coverage: 0 })) : []);

    for (const { label, coverage } of labels) {
      if (!label || STOPish.has(String(label).toLowerCase())) continue;
      const cur = seen.get(label) ?? { label, freq: 0, coverage: 0 };
      cur.freq += 1;
      cur.coverage = Math.max(cur.coverage, coverage);
      seen.set(label, cur);
    }
  }
  return [...seen.values()];
}

/**
 * Build the weighted vocabulary from the library.
 * @param {number} [limit]  how many terms to sample from
 * @returns {Promise<{label,freq,coverage,density}[]>} sorted sparsest-first
 */
export async function build({ limit = 500 } = {}) {
  const db = await MongoConnexion.db();
  const docs = await db.collection('data')
    .find({ $or: [{ labels: { $exists: true, $ne: [] } }, { subjects: { $exists: true, $ne: [] } }] },
      { projection: { labels: 1, subjects: 1 } })
    .limit(limit)
    .toArray();

  const terms = tally(docs);
  // Density ≈ frequency here; a term the library barely has is a good gap to fill.
  const total = terms.reduce((n, t) => n + t.freq, 0) || 1;
  return terms
    .map(t => ({ ...t, density: t.freq / total }))
    .sort((a, b) => a.density - b.density);
}

/** A few terms to steer with: mostly sparse, with a little variety. */
export function steeringTerms(vocab, n = 6, rand = Math.random) {
  if (!vocab.length) return [];
  const sparse = vocab.slice(0, Math.max(n * 2, n));
  // Shuffle the sparse head and take n, so it is not the identical set each time.
  const shuffled = [...sparse].sort(() => rand() - 0.5);
  return shuffled.slice(0, n).map(t => t.label);
}

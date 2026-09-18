import fs from 'fs/promises';

import MongoConnexion from '../utils/MongoConnexion.js';
import { validate, isMachineOwned } from '../model/document.js';
import { HALF_LIFE_DAYS, RECENCY_FLOOR } from '../utils/selection.js';

/**
 * Bytes of machine-owned media to keep — anything generated or fetched. Uploads
 * are never counted and never deleted, so the machine cleans up after itself and
 * nothing you put in can be lost.
 */
// `??` not `||`: DATA_BUDGET_MB=0 is a legitimate setting meaning "keep no
// generated media", and `||` would silently turn it into the default.
export const BUDGET_BYTES = Number(process.env.DATA_BUDGET_MB ?? 1024) * 1024 * 1024;

/** Edge types that record provenance rather than preference. */
const STRUCTURAL_EDGES = new Set(['derivative', 'soundtrack', 'sequence']);

/** Edges below this are treated as uninteresting associations. */
const EDGE_THRESHOLD = Number(process.env.EDGE_PRUNE_THRESHOLD || 0.1);

/**
 * Keep the library healthy and bounded.
 *
 * Two separate jobs:
 *
 * 1. Repair — documents whose file has gone, documents that no longer satisfy the
 *    model, and edges pointing at documents that do not exist. These are broken
 *    regardless of any budget, and each one stalls playback if selected.
 *
 * 2. Budget — if generated media exceeds DATA_BUDGET_MB, delete the
 *    lowest-scoring first, by the same `weight × recency` score playback uses, so
 *    what goes is what you engage with least and what is oldest.
 *
 * @param {object}  [params]
 * @param {boolean} [params.dryRun]   Report what would go without deleting
 * @param {number}  [params.budgetMb] Override the byte budget
 */
async function prune({ dryRun = false, budgetMb } = {}) {
  const db = await MongoConnexion.db();
  const col = db.collection('data');
  const edgeCol = db.collection('edges');
  const budget = budgetMb === undefined ? BUDGET_BYTES : Number(budgetMb) * 1024 * 1024;

  const docs = await col.find({}).toArray();
  const now = Date.now();

  const broken = [];
  const generated = [];
  let generatedBytes = 0;
  let originalBytes = 0;

  for (const doc of docs) {
    let size = null;
    try {
      size = (await fs.stat(doc.source)).size;
    } catch {
      broken.push({ key: doc.key, why: 'file is gone' });
      continue;
    }

    if (!validate(doc).valid) {
      broken.push({ key: doc.key, why: 'fails the document model' });
      continue;
    }

    // Fetched content counts against the budget too: the machine acquired it, so
    // the machine may reclaim it. Only uploads are untouchable.
    if (!isMachineOwned(doc)) { originalBytes += size; continue; }

    const ageDays = (now - doc._id.getTimestamp().getTime()) / 86_400_000;
    const recency = Math.max(RECENCY_FLOOR, 2 ** (-ageDays / HALF_LIFE_DAYS));
    generated.push({ key: doc.key, size, ageDays, score: (doc.weight ?? 0) * recency });
    generatedBytes += size;
  }

  // Lowest score first: score already folds in age, so this is the least liked
  // and oldest together.
  generated.sort((a, b) => a.score - b.score);

  const evicted = [];
  let freed = 0;
  for (const item of generated) {
    if (generatedBytes - freed <= budget) break;
    evicted.push(item);
    freed += item.size;
  }

  const doomed = [...broken.map(b => b.key), ...evicted.map(e => e.key)];

  // Edges whose endpoints are gone, plus weak associations. Provenance edges are
  // spared: a `derivative` or `soundtrack` edge records where something came
  // from, which is not an opinion to be voted away.
  const liveKeys = new Set(docs.map(d => d.key).filter(k => !doomed.includes(k)));
  const allEdges = await edgeCol.find({}).toArray();
  const deadEdges = allEdges.filter(e =>
    !liveKeys.has(e.from) || !liveKeys.has(e.to) ||
    (!STRUCTURAL_EDGES.has(e.type) && (e.weight ?? 1) < EDGE_THRESHOLD));

  const report = {
    dryRun,
    budgetMb: Math.round(budget / 1048576),
    originalsMb: +(originalBytes / 1048576).toFixed(1),
    generatedMb: +(generatedBytes / 1048576).toFixed(1),
    freedMb: +(freed / 1048576).toFixed(1),
    broken: broken.length,
    evicted: evicted.length,
    edges: deadEdges.length,
  };

  if (dryRun) {
    console.log('prune (dry run):', JSON.stringify(report));
    return { ...report, wouldRemove: doomed, wouldRemoveEdges: deadEdges.length };
  }

  for (const item of evicted) {
    const doc = docs.find(d => d.key === item.key);
    if (doc) await fs.unlink(doc.source).catch(() => {});
  }

  if (doomed.length) await col.deleteMany({ key: { $in: doomed } });
  if (deadEdges.length) await edgeCol.deleteMany({ key: { $in: deadEdges.map(e => e.key) } });

  if (broken.length || evicted.length || deadEdges.length) {
    console.log(
      `prune: ${broken.length} broken, ${evicted.length} evicted (${report.freedMb}MB freed), ` +
      `${deadEdges.length} edges — generated now ${(report.generatedMb - report.freedMb).toFixed(1)}MB of ${report.budgetMb}MB`,
    );
    for (const b of broken) console.log(`  broken: ${b.key} — ${b.why}`);
  }

  return report;
}

export default prune;

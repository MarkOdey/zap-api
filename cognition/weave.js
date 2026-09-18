import MongoConnexion from '../utils/MongoConnexion.js';
import queue from '../utils/queue.js';
import { SOUNDTRACK } from '../relation/statement.js';

/**
 * Turns soundtrack pairings into videos, unattended.
 *
 * Defaults to `linked` mode: it only renders pairs that already have a
 * `soundtrack` edge, so it materialises decisions someone made rather than
 * inventing content. That makes `speak` self-completing — narrate a text document
 * and a video of it appears without further instruction.
 *
 * `WEAVE_MODE=random` also pairs a visual with an arbitrary track, which does
 * invent content; it is off by default for that reason.
 */
const MODE = (process.env.WEAVE_MODE || 'linked').toLowerCase();

/** Hard ceiling on rendered videos, so an unattended task cannot fill the disk. */
const MAX_RENDERS = Number(process.env.WEAVE_MAX_RENDERS || 50);

const ENABLED = process.env.WEAVE_ENABLED !== 'false';

/**
 * Pairs whose render failed. Retrying every tick would spin the queue on a
 * broken file forever; this clears on restart, which is a reasonable retry.
 */
const failed = new Set();

export function noteFailure(visual, audio) {
  failed.add(`${visual}::${audio}`);
}

// Watch the queue rather than have the worker report back, so the retry rule
// lives with the task that owns it.
queue.on('change', (job) => {
  if (job.action !== 'render' || job.state !== 'failed') return;
  const { visual, audio } = job.params ?? {};
  if (!visual || !audio) return;
  noteFailure(visual, audio);
  console.warn(`weave: not retrying ${visual} + ${audio} — ${job.error}`);
});

export default async function weaveTask() {
  if (!ENABLED) return;

  // One at a time: the queue is concurrency-1, and an unattended task must not
  // starve anything triggered by hand.
  const { jobs } = queue.snapshot();
  if (jobs.some(j => j.action === 'render' && (j.state === 'queued' || j.state === 'running'))) return;

  const db = await MongoConnexion.db();
  const col = db.collection('data');

  const rendered = await col.countDocuments({ generator: 'render' });
  if (rendered >= MAX_RENDERS) return;

  const pair = MODE === 'random'
    ? await randomPair(db)
    : await linkedPair(db);

  if (!pair) return;

  queue.push('render', { visual: pair.visual, audio: pair.audio });
  console.log(`weave: queued render of ${pair.visual} + ${pair.audio}`);
}

/** The oldest soundtrack pairing that has not been rendered yet. */
async function linkedPair(db) {
  const edges = await db.collection('edges').find({ type: SOUNDTRACK }).toArray();
  const col = db.collection('data');

  for (const edge of edges) {
    if (failed.has(`${edge.from}::${edge.to}`)) continue;

    const already = await col.countDocuments({
      generator: 'render',
      derivedFrom: { $all: [edge.from, edge.to] },
    });
    if (already) continue;

    // Both ends must still exist and be renderable.
    const visual = await col.findOne({ key: edge.from });
    const audio = await col.findOne({ key: edge.to });
    if (!visual || !audio) continue;
    if (!audio.type?.includes('audio')) continue;
    if (!isRenderableVisual(visual)) continue;

    return { visual: visual.key, audio: audio.key };
  }

  return null;
}

/** A random unrendered visual paired with a random track. */
async function randomPair(db) {
  const col = db.collection('data');

  const [audio] = await col.aggregate([
    { $match: { type: /^audio\// } },
    { $sample: { size: 1 } },
  ]).toArray();
  if (!audio) return null;

  const [visual] = await col.aggregate([
    { $match: { type: /^(image|video|text)\// , generator: { $exists: false } } },
    { $sample: { size: 1 } },
  ]).toArray();
  if (!visual || !isRenderableVisual(visual)) return null;

  if (failed.has(`${visual.key}::${audio.key}`)) return null;

  const already = await col.countDocuments({
    generator: 'render',
    derivedFrom: { $all: [visual.key, audio.key] },
  });
  if (already) return null;

  return { visual: visual.key, audio: audio.key };
}

/**
 * Renders produce video, which is itself a renderable visual — so without this a
 * rendered file would be picked up and rendered again, and again.
 */
function isRenderableVisual(doc) {
  const kind = doc.type?.split('/')[0];
  if (!['image', 'video', 'text'].includes(kind)) return false;
  return doc.generator !== 'render';
}

import MongoConnexion from '../utils/MongoConnexion.js';
import queue from '../utils/queue.js';
import { SOUNDTRACK } from '../relation/statement.js';

/**
 * Keeps the library growing: every tick, if nothing is in flight, pick a
 * transformation that applies to the media on hand and queue it with random inputs.
 *
 * Supersedes the earlier `weave` task, which only rendered soundtrack pairings —
 * that is now the first strategy here. Two tasks both feeding the same
 * concurrency-1 queue would have taken turns for no benefit.
 */
const ENABLED = process.env.GENERATE_ENABLED !== 'false';

/** Ceiling on generated documents. A 30s generator fills a disk quickly otherwise. */
const MAX_DOCS = Number(process.env.GENERATE_MAX_DOCS || 200);

/** Video effects worth applying unattended. Trim and rotate need arguments to mean much. */
const VIDEO_EFFECTS = ['speed', 'reverse', 'greyscale', 'colour', 'fade'];
const STILL_EFFECTS = ['zoom', 'pan'];

/** Pairs whose job failed, so a broken file is not retried every 30 seconds. */
const failed = new Set();

queue.on('change', (job) => {
  if (job.state !== 'failed') return;
  failed.add(signature(job.action, job.params));
  console.warn(`generate: not retrying ${job.action} — ${job.error}`);
});

const signature = (action, params = {}) =>
  `${action}::${Object.values(params).filter(v => typeof v === 'string').sort().join('|')}`;

export default async function generateTask() {
  if (!ENABLED) return;

  // Strictly one thing at a time. The queue is concurrency-1 and jobs run for
  // seconds to minutes, so anything queued here while work is in flight would
  // stack up behind it and starve whatever the user triggers by hand.
  const { jobs } = queue.snapshot();
  if (jobs.some(j => j.state === 'queued' || j.state === 'running')) return;

  const db = await MongoConnexion.db();
  const col = db.collection('data');

  const generated = await col.countDocuments({ generator: { $exists: true } });
  if (generated >= MAX_DOCS) return;

  const candidates = await gather(db, col);
  const options = await strategies(db, col, candidates);
  const usable = options.filter(o => o && !failed.has(signature(o.action, o.params)));

  if (usable.length === 0) return;

  const choice = usable[Math.floor(Math.random() * usable.length)];
  queue.push(choice.action, choice.params);
  console.log(`generate: queued ${choice.action} ${JSON.stringify(choice.params)} (${choice.why})`);
}

/**
 * Source material. Only originals are used as inputs: a transformation's output is
 * itself transformable, so feeding results back in compounds without bound.
 */
async function gather(db, col) {
  const original = { generator: { $exists: false } };
  const sample = async (type, size) =>
    col.aggregate([{ $match: { ...original, type } }, { $sample: { size } }]).toArray();

  const [images, videos, audio, texts] = await Promise.all([
    sample(/^image\//, 6),
    sample(/^video\//, 3),
    sample(/^audio\//, 3),
    sample(/^text\//, 3),
  ]);

  return { images, videos, audio, texts };
}

async function strategies(db, col, { images, videos, audio, texts }) {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const out = [];

  // 1. A pairing someone actually made, not yet rendered — deliberate beats random.
  const linked = await unrenderedPair(db, col);
  if (linked) out.push({ action: 'render', params: linked, why: 'linked soundtrack' });

  // 2. Text with no narration yet.
  for (const text of texts) {
    const narrated = await col.countDocuments({ generator: 'speak', derivedFrom: text.key });
    if (!narrated) {
      out.push({ action: 'speak', params: { key: text.key }, why: 'text without narration' });
      break;
    }
  }

  // 3. A still or a clip scored with a random track.
  if (audio.length && (images.length || videos.length)) {
    const visual = pick([...images, ...videos]);
    out.push({
      action: 'render',
      params: { visual: visual.key, audio: pick(audio).key },
      why: 'random pairing',
    });
  }

  // 4. A clip put through an effect.
  if (videos.length) {
    out.push({
      action: 'effect',
      params: { key: pick(videos).key, effect: pick(VIDEO_EFFECTS) },
      why: 'video effect',
    });
  }

  // 5. A still animated, or a shape cut out of it.
  if (images.length) {
    const image = pick(images);
    out.push({
      action: 'effect',
      params: { key: image.key, effect: pick(STILL_EFFECTS) },
      why: 'still animated',
    });
    out.push({ action: 'isolate', params: { key: pick(images).key }, why: 'shape isolated' });
  }

  // 6. Several items joined.
  const joinable = [...images, ...videos];
  if (joinable.length >= 3) {
    out.push({
      action: 'montage',
      params: { keys: joinable.slice(0, 4).map(d => d.key), seconds: 2 },
      why: 'montage',
    });
  }

  return out;
}

/** The first soundtrack pairing with no rendered result. */
async function unrenderedPair(db, col) {
  const edges = await db.collection('edges').find({ type: SOUNDTRACK }).limit(25).toArray();

  for (const edge of edges) {
    const done = await col.countDocuments({
      generator: 'render',
      derivedFrom: { $all: [edge.from, edge.to] },
    });
    if (done) continue;

    const visual = await col.findOne({ key: edge.from });
    const track = await col.findOne({ key: edge.to });
    if (!visual || !track?.type?.includes('audio')) continue;
    if (!/^(image|video|text)\//.test(visual.type ?? '')) continue;

    return { visual: visual.key, audio: track.key };
  }

  return null;
}

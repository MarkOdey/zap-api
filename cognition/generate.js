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

/**
 * Optional ceiling on generated documents. Unset by default.
 *
 * A count is the wrong limit: generated files range from a 4KB cutout to a 5MB
 * scored video, so two hundred documents is anywhere between a megabyte and a
 * gigabyte. Worse, it contradicted the byte budget prune enforces — generation
 * stopped dead at two hundred documents while sitting at 328MB of a 1024MB budget,
 * and prune would not evict anything to make room because it was well under. The
 * system could neither create nor reclaim.
 *
 * DATA_BUDGET_MB is the limit now, enforced in one place: prune evicts the
 * lowest-scoring generated media once the bytes exceed it, and generation carries
 * on. Set GENERATE_MAX_DOCS to reinstate a count cap.
 */
const MAX_DOCS = process.env.GENERATE_MAX_DOCS === undefined
  ? Infinity
  : Number(process.env.GENERATE_MAX_DOCS);

/** Video effects worth applying unattended. Trim and rotate need arguments to mean much. */
const VIDEO_EFFECTS = ['speed', 'reverse', 'greyscale', 'colour', 'fade'];
const STILL_EFFECTS = ['zoom', 'zoomout', 'pan', 'kenburns'];
const ADJUSTMENTS = ['blur', 'greyscale', 'negate', 'colour', 'tint', 'gamma', 'posterize', 'bloom'];

/**
 * Feeds are polled as one of the strategies below rather than on their own timer,
 * but not every 30 seconds — that would be rude to the publisher and pointless,
 * since feeds change on the order of minutes.
 */
const FEED_MIN_INTERVAL_MS = Number(process.env.FEED_MIN_INTERVAL_MS || 15 * 60 * 1000);
let lastIngest = 0;

/** Pairs whose job failed, so a broken file is not retried every 30 seconds. */
const failed = new Set();

/** The job queued last, so a second is never stacked behind it. */
let lastQueued = null;

queue.on('change', (job) => {
  if (job.state !== 'failed') return;
  failed.add(signature(job.action, job.params));
  console.warn(`generate: not retrying ${job.action} — ${job.error}`);
});

const signature = (action, params = {}) =>
  `${action}::${Object.values(params).filter(v => typeof v === 'string').sort().join('|')}`;

export default async function generateTask() {
  if (!ENABLED) return;

  // Hold off while work is actually in flight, and never stack a second job of our
  // own — but do not skip merely because something short is waiting its turn.
  //
  // Skipping on anything *queued* meant that at a 5s drain interval an explore
  // job, which runs in about 200ms, blocked generation for the entire time it sat
  // in the queue. Measured: half of all ticks produced nothing.
  const { jobs } = queue.snapshot();

  if (jobs.some(j => j.state === 'running')) return;
  if (lastQueued && jobs.some(j => j.id === lastQueued && j.state === 'queued')) return;

  const db = await MongoConnexion.db();
  const col = db.collection('data');

  if (Number.isFinite(MAX_DOCS)) {
    const generated = await col.countDocuments({ generator: { $exists: true } });
    if (generated >= MAX_DOCS) return;
  }

  const candidates = await gather(db, col);
  const options = await strategies(db, col, candidates);
  const usable = options.filter(o => o && !failed.has(signature(o.action, o.params)));

  if (usable.length === 0) return;

  const choice = usable[Math.floor(Math.random() * usable.length)];
  if (choice.action === 'ingest') lastIngest = Date.now();
  lastQueued = queue.push(choice.action, choice.params).id;
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

  // 1. Fresh material from subscribed feeds, if any and if it has been a while.
  if (Date.now() - lastIngest > FEED_MIN_INTERVAL_MS) {
    const feeds = await db.collection('feeds').countDocuments();
    if (feeds > 0) {
      // Bias ingest toward what the user is being prompted about and the season.
      const terms = await currentTerms(db);
      out.push({ action: 'ingest', params: terms.length ? { terms } : {}, why: terms.length ? 'feeds (term-biased)' : 'feeds' });
    }
  }

  // 2. A pairing someone actually made, not yet rendered — deliberate beats random.
  const linked = await unrenderedPair(db, col);
  if (linked) out.push({ action: 'render', params: linked, why: 'linked soundtrack' });

  // 3. An image nothing has looked at yet. Cheap, and it is what gives the graph
  //    something to link on.
  for (const image of images) {
    if (!image.labels) {
      out.push({ action: 'analyse', params: { key: image.key }, why: 'image not yet analysed' });
      break;
    }
  }

  // 4. Feed text that still carries its padding.
  for (const text of texts) {
    if (!text.summarizedFrom) {
      out.push({ action: 'summarize', params: { key: text.key }, why: 'text not yet condensed' });
      break;
    }
  }

  // 5. Text with no narration yet — but only once it has been condensed. Reading a
  // raw feed item aloud means sounding out its URLs and vote counts.
  for (const text of texts) {
    if (text.origin && !text.summarizedFrom) continue;
    const narrated = await col.countDocuments({ generator: 'speak', derivedFrom: text.key });
    if (!narrated) {
      out.push({ action: 'speak', params: { key: text.key }, why: 'text without narration' });
      break;
    }
  }

  // 6. A still or a clip scored with a random track.
  if (audio.length && (images.length || videos.length)) {
    const visual = pick([...images, ...videos]);
    out.push({
      action: 'render',
      params: { visual: visual.key, audio: pick(audio).key },
      why: 'random pairing',
    });
  }

  // 7. A clip put through an effect.
  if (videos.length) {
    out.push({
      action: 'effect',
      params: { key: pick(videos).key, effect: pick(VIDEO_EFFECTS) },
      why: 'video effect',
    });
  }

  // 8. A still animated, or a shape cut out of it.
  if (images.length) {
    const image = pick(images);
    out.push({
      action: 'effect',
      params: { key: image.key, effect: pick(STILL_EFFECTS) },
      why: 'still animated',
    });
    out.push({ action: 'isolate', params: { key: pick(images).key }, why: 'shape isolated' });
    out.push({
      action: 'adjust',
      params: { key: pick(images).key, adjust: pick(ADJUSTMENTS) },
      why: 'still adjusted',
    });
  }

  // 9. Several items joined, scored if there is anything to score them with.
  const joinable = [...images, ...videos];
  if (joinable.length >= 3) {
    const params = { keys: joinable.slice(0, 4).map(d => d.key), seconds: 2 };
    if (audio.length) params.audio = pick(audio).key;
    out.push({ action: 'montage', params, why: params.audio ? 'montage with a track' : 'montage' });
  }

  return out;
}

/**
 * Terms the system is currently focused on: open-mission terms plus the current
 * theme's lexicon. Used to steer feed ingest toward relevant/seasonal media.
 */
async function currentTerms(db) {
  const terms = new Set();
  try {
    const missions = await db.collection('missions')
      .find({ status: 'open' }, { projection: { terms: 1 } }).limit(5).toArray();
    for (const m of missions) for (const t of m.terms ?? []) terms.add(t);

    const [theme] = await db.collection('themes')
      .find({ expiresAt: { $gt: new Date() } }).sort({ generatedAt: -1 }).limit(1).toArray();
    for (const t of theme?.terms ?? []) terms.add(t);
  } catch { /* no focus terms — plain ingest */ }
  return [...terms].slice(0, 12);
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

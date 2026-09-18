import fs from 'fs/promises';
import path from 'path';

import find from './find.js';
import record from './record.js';
import connect from './connect.js';
import MongoConnexion from '../utils/MongoConnexion.js';
import { probeStreams } from '../utils/ffprobe.js';
import { runFfmpeg } from './effect.js';
import { SOUNDTRACK } from '../relation/statement.js';

const WIDTH = Number(process.env.MONTAGE_WIDTH || 1280);
const HEIGHT = Number(process.env.MONTAGE_HEIGHT || 720);
const FPS = Number(process.env.MONTAGE_FPS || 25);
const STILL_SECONDS = Number(process.env.MONTAGE_STILL_SECONDS || 3);
const MAX_ITEMS = Number(process.env.MONTAGE_MAX_ITEMS || 12);
const PRESET = process.env.RENDER_PRESET || 'veryfast';

/**
 * Join several library items into one video.
 *
 * Either name the items with `keys`, or give `from` and let it walk the edge
 * graph that `relate` and `connect` have been building — so the montage follows
 * the same associations playback does.
 *
 * Uses the concat *filter* rather than the demuxer: the demuxer needs every input
 * to share codec, resolution and frame rate, which would mean normalizing each
 * source first. The filter scales and pads each input in one pass instead.
 *
 * Silent unless `audio` names a track, in which case it is muxed in the same pass
 * rather than requiring a second render — a series of images plus sound is one
 * call. The video is cut to the shorter of the two.
 *
 * @param {object}   params
 * @param {string[]} [params.keys]    Explicit items, in order
 * @param {string}   [params.from]    Start key for an edge walk
 * @param {number}   [params.count]   How many items to gather when walking (default 5)
 * @param {number}   [params.seconds] Seconds per still (default 3)
 * @param {string}   [params.audio]   Key of an audio document to lay under it
 */
async function montage({ keys, from, count = 5, seconds = STILL_SECONDS, audio } = {}) {
  const wanted = Math.min(MAX_ITEMS, Math.max(2, Number(count) || 5));

  const chosen = Array.isArray(keys) && keys.length
    ? keys.slice(0, MAX_ITEMS)
    : await walk(from, wanted);

  if (chosen.length < 2) {
    throw new Error('montage: need at least 2 items — pass keys, or a `from` key with edges');
  }

  const docs = [];
  for (const key of chosen) {
    const doc = await find(key);
    if (!doc) { console.warn('montage: skipping missing', key); continue; }
    const kind = doc.type?.split('/')[0];
    if (kind !== 'image' && kind !== 'video') { console.warn('montage: skipping', doc.type, key); continue; }
    docs.push({ doc, kind, streams: await probeStreams(doc.source) });
  }

  if (docs.length < 2) throw new Error('montage: fewer than 2 usable items after filtering');

  let track = null;
  if (audio) {
    track = await find(audio);
    if (!track) throw new Error(`montage: no document for key ${audio}`);
    if (!track.type?.includes('audio')) {
      throw new Error(`montage: ${audio} is ${track.type || 'untyped'}, expected audio`);
    }
  }

  const dataDir = process.env.DATA_DIR || './data';
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outPath = path.join(dataDir, `montage-${stamp}.mp4`);

  // Each input is scaled to fit, padded to the exact frame, and forced to one
  // frame rate — concat refuses inputs that disagree on any of those.
  const args = ['-y'];
  docs.forEach(({ doc, kind }) => {
    // -loop belongs to the image2 demuxer, which handles jpg/png/webp. A GIF uses the
    // gif demuxer, which has no such option and makes ffmpeg fail outright — but it
    // does accept the generic -stream_loop. They are not interchangeable: -stream_loop
    // on a still does not produce a continuous stream of frames, so a montage built
    // entirely from it collapsed to a couple of seconds.
    if (kind === 'image') {
      args.push(...loopArgs(doc.type), '-t', String(seconds));
    }
    args.push('-i', doc.source);
  });

  const chains = docs.map((_, i) =>
    `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS},format=yuv420p[v${i}]`,
  );
  const inputs = docs.map((_, i) => `[v${i}]`).join('');
  const filter = `${chains.join(';')};${inputs}concat=n=${docs.length}:v=1:a=0[out]`;

  if (track) args.push('-i', track.source);

  args.push('-filter_complex', filter, '-map', '[out]');

  if (track) {
    // The visuals have a fixed length, so cut at whichever runs out first rather
    // than leaving silence or a frozen tail.
    const visualSeconds = docs.reduce(
      (total, d) => total + (d.kind === 'image' ? seconds : (d.streams.duration ?? seconds)),
      0,
    );
    const trackSeconds = await probeStreams(track.source).then(s => s.duration ?? visualSeconds);
    args.push(
      '-map', `${docs.length}:a:0`,
      '-c:a', 'aac', '-b:a', '192k',
      '-t', String(Math.min(visualSeconds, trackSeconds)),
    );
  } else {
    args.push('-an');
  }

  args.push(
    '-c:v', 'libx264', '-preset', PRESET,
    '-movflags', '+faststart',
    outPath,
  );

  console.log(`montage: ${docs.length} items${track ? ` + ${track.key}` : ''} → ${outPath}`);
  docs.forEach(({ doc, kind }) => console.log(`  ${kind.padEnd(5)} ${doc.key}`));

  const startedAt = Date.now();
  await runFfmpeg(args);
  const took = (Date.now() - startedAt) / 1000;
  const { size } = await fs.stat(outPath);

  await record({
    key: outPath,
    source: outPath,
    name: path.basename(outPath),
    type: 'video/mp4',
    generator: 'montage',
    derivedFrom: [...docs.map(d => d.doc.key), ...(track ? [track.key] : [])],
  });

  for (const { doc } of docs) {
    await connect({ from: doc.key, to: outPath, type: 'derivative', weight: 0.8 });
  }

  console.log(`montage: wrote ${outPath} (${(size / 1048576).toFixed(1)}MB in ${took.toFixed(1)}s)`);
  return { key: outPath, items: docs.length, seconds: took, bytes: size };
}

/** The right way to hold an image input open, by demuxer. */
export const loopArgs = (type) =>
  (type === 'image/gif' ? ['-stream_loop', '-1'] : ['-loop', '1']);

/**
 * Collect keys by walking outgoing edges, breadth-first, without repeats.
 * Soundtrack edges are skipped — they point at audio, which has no frames.
 */
async function walk(start, wanted) {
  if (!start) throw new Error('montage: give either keys or a `from` key');

  const db = await MongoConnexion.db();
  const edges = db.collection('edges');

  const ordered = [start];
  const seen = new Set(ordered);
  const queue = [start];

  while (queue.length && ordered.length < wanted) {
    const current = queue.shift();
    const next = await edges.find({ from: current, type: { $ne: SOUNDTRACK } }).toArray();

    for (const edge of next) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      ordered.push(edge.to);
      queue.push(edge.to);
      if (ordered.length >= wanted) break;
    }
  }

  return ordered;
}

export default montage;

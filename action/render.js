import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import find from './find.js';
import record from './record.js';
import connect from './connect.js';
import MongoConnexion from '../utils/MongoConnexion.js';
import { SOUNDTRACK } from '../relation/statement.js';
import { probeDuration } from '../utils/ffprobe.js';
import { renderTextFrame } from '../utils/textFrame.js';

/** Long edge of the rendered video. Keeps output sane from 16MP stills. */
const MAX_DIM = Number(process.env.RENDER_MAX_DIM || 1280);

/** Frames per second for a still. It never changes, so this only costs file size. */
const STILL_FPS = Number(process.env.RENDER_STILL_FPS || 12);

const PRESET = process.env.RENDER_PRESET || 'veryfast';

/**
 * Render a new video from a visual and an audio track.
 *
 * - image + audio → the still held for the length of the track
 * - video + audio → the clip with its audio replaced
 *
 * With no `audio`, a `soundtrack` edge on the visual is used if one exists, so a
 * pairing made with `connect` can be rendered without repeating it.
 *
 * @param {object}  params
 * @param {string}  params.visual    Key of an image or video document
 * @param {string} [params.audio]    Key of an audio document
 * @param {number} [params.maxDim]   Long-edge cap (default RENDER_MAX_DIM)
 * @param {string} [params.background] Colour behind a transparent cutout (default black)
 * @returns {Promise<{key: string, seconds: number}>}
 */
async function render({ visual, audio, maxDim = MAX_DIM, background = 'black' } = {}) {
  if (!visual) throw new Error('render: visual is required');

  const visualDoc = await find(visual);
  if (!visualDoc) throw new Error(`render: no document for key ${visual}`);

  const kind = visualDoc.type?.split('/')[0];
  if (kind !== 'image' && kind !== 'video' && kind !== 'text') {
    throw new Error(`render: ${visual} is ${visualDoc.type || 'untyped'}, expected image, video or text`);
  }

  // Fall back to a soundtrack edge, so `connect ... --type=soundtrack` pairings render.
  let audioKey = audio;
  if (!audioKey) {
    const db = await MongoConnexion.db();
    const edge = await db.collection('edges').findOne({ from: visualDoc.key, type: SOUNDTRACK });
    audioKey = edge?.to;
  }
  if (!audioKey) throw new Error(`render: no audio given and no soundtrack edge on ${visual}`);

  const audioDoc = await find(audioKey);
  if (!audioDoc) throw new Error(`render: no document for key ${audioKey}`);
  if (!audioDoc.type?.includes('audio')) {
    throw new Error(`render: ${audioKey} is ${audioDoc.type || 'untyped'}, expected audio`);
  }

  const dataDir = process.env.DATA_DIR || './data';
  const base = path.basename(visualDoc.source, path.extname(visualDoc.source));

  // Text has no frames, so rasterise it to one and follow the still path. The
  // frame goes to a temp directory, not DATA_DIR: explore scans that directory on
  // a timer and would index the intermediate, leaving an orphan behind.
  let framePath = null;
  let visualSource = visualDoc.source;
  if (kind === 'text') {
    const body = await fs.readFile(visualDoc.source, 'utf8');
    const frame = await renderTextFrame(body, {
      width: maxDim,
      height: Math.round((maxDim * 9) / 16 / 2) * 2,
      background,
    });
    framePath = path.join(os.tmpdir(), `zap-frame-${process.pid}-${Date.now()}.png`);
    await fs.writeFile(framePath, frame);
    visualSource = framePath;
  }
  const track = path.basename(audioDoc.source, path.extname(audioDoc.source));
  const outPath = path.join(dataDir, `${base}.with-${track}.mp4`);

  // -shortest overshoots: with a 6.03s track it produced 8.42s from a still and
  // 6.93s from a clip, leaving a frozen frame over silence. Probe instead and cut
  // at an explicit duration — the shorter of the two streams.
  const audioSeconds = await probeDuration(audioDoc.source);
  const visualSeconds = kind === 'video' ? await probeDuration(visualSource) : Infinity;
  const duration = Math.min(audioSeconds, visualSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`render: could not determine a duration for ${audioDoc.key}`);
  }

  // Even dimensions are required by yuv420p, and `format` flattens the alpha a
  // cutout carries onto the background — video has no transparency.
  const filter = [
    `scale='min(${maxDim},iw)':-2`,
    `pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:${background}`,
    'format=yuv420p',
  ].join(',');

  const args = kind !== 'video'
    ? [
      '-loop', '1', '-framerate', String(STILL_FPS), '-i', visualSource,
      '-i', audioDoc.source,
      '-vf', filter,
      '-c:v', 'libx264', '-preset', PRESET, '-tune', 'stillimage',
      '-c:a', 'aac', '-b:a', '192k',
      '-t', String(duration),
      '-movflags', '+faststart', '-y', outPath,
    ]
    : [
      '-i', visualSource,
      '-i', audioDoc.source,
      '-map', '0:v:0', '-map', '1:a:0',
      '-vf', filter,
      '-c:v', 'libx264', '-preset', PRESET,
      '-c:a', 'aac', '-b:a', '192k',
      '-t', String(duration),
      '-movflags', '+faststart', '-y', outPath,
    ];

  console.log(`render: ${kind} ${visualDoc.key} + ${audioDoc.key} → ${outPath} (${duration.toFixed(2)}s)`);
  const startedAt = Date.now();
  try {
    await runFfmpeg(args);
  } finally {
    if (framePath) await fs.unlink(framePath).catch(() => {});
  }
  const seconds = (Date.now() - startedAt) / 1000;

  const { size } = await fs.stat(outPath);

  await record({
    key: outPath,
    source: outPath,
    name: path.basename(outPath),
    type: 'video/mp4',
    generator: 'render',
    derivedFrom: [visualDoc.key, audioDoc.key],
  });

  await connect({ from: visualDoc.key, to: outPath, type: 'derivative', weight: 0.8 });
  await connect({ from: audioDoc.key, to: outPath, type: 'derivative', weight: 0.8 });

  console.log(`render: wrote ${outPath} (${(size / 1048576).toFixed(1)}MB in ${seconds.toFixed(1)}s)`);
  return { key: outPath, seconds, bytes: size };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').pop()}`));
      else resolve();
    });
  });
}

export default render;

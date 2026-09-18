import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import find from './find.js';
import record from './record.js';
import connect from './connect.js';
import { probeStreams } from '../utils/ffprobe.js';

const MAX_DIM = Number(process.env.EFFECT_MAX_DIM || 1280);
const PRESET = process.env.RENDER_PRESET || 'veryfast';

/** Default length for effects that turn a still into motion. */
const STILL_SECONDS = Number(process.env.EFFECT_STILL_SECONDS || 6);

/**
 * Effects that animate a still image into a clip. Everything else needs a video.
 */
const MOTION = new Set(['zoom', 'zoomout', 'pan', 'kenburns']);

/**
 * Builds the filter chains for one effect.
 * Each returns {video, audio} filter strings, either possibly empty.
 */
const EFFECTS = {
  /** Playback rate. 2 is twice as fast, 0.5 half. */
  speed: ({ factor = 2 }) => {
    const f = clamp(Number(factor) || 2, 0.25, 4);
    return {
      video: `setpts=${(1 / f).toFixed(6)}*PTS`,
      // atempo only accepts 0.5–2.0, so chain it for anything beyond that.
      audio: atempoChain(f),
    };
  },

  reverse: () => ({ video: 'reverse', audio: 'areverse' }),

  /** Fade from and to black. */
  fade: ({ seconds = 1, duration }) => {
    const d = Number(seconds) || 1;
    const out = Math.max(0, (Number(duration) || 0) - d);
    return {
      video: `fade=t=in:st=0:d=${d}` + (out ? `,fade=t=out:st=${out}:d=${d}` : ''),
      audio: `afade=t=in:st=0:d=${d}` + (out ? `,afade=t=out:st=${out}:d=${d}` : ''),
    };
  },

  /** Brightness -1..1, contrast 0..3, saturation 0..3. */
  colour: ({ brightness = 0, contrast = 1, saturation = 1 }) => ({
    video: `eq=brightness=${Number(brightness)}:contrast=${Number(contrast)}:saturation=${Number(saturation)}`,
    audio: '',
  }),

  greyscale: () => ({ video: 'hue=s=0', audio: '' }),

  /** 90, 180 or 270 degrees. */
  rotate: ({ degrees = 90 }) => {
    const d = ((Number(degrees) % 360) + 360) % 360;
    const map = { 90: 'transpose=1', 180: 'transpose=1,transpose=1', 270: 'transpose=2' };
    return { video: map[d] ?? '', audio: '' };
  },

  /** Slow push in or out — the movement a rendered still otherwise lacks. */
  zoom: ({ seconds = STILL_SECONDS, fps = 25, to = 1.25 }) => {
    const frames = Math.max(1, Math.round(Number(seconds) * Number(fps)))
    const end = clamp(Number(to) || 1.25, 1.01, 3)
    const step = ((end - 1) / frames).toFixed(8)
    return {
      // zoompan works on a scaled-up copy, or the result shimmers badly.
      video: `scale=${MAX_DIM * 2}:-2,zoompan=z='min(zoom+${step},${end})':d=${frames}:s=${MAX_DIM}x${Math.round(MAX_DIM * 9 / 16 / 2) * 2}:fps=${fps}`,
      audio: '',
    }
  },

  /** Pull back rather than push in. */
  zoomout: ({ seconds = STILL_SECONDS, fps = 25, from = 1.35 }) => {
    const frames = Math.max(1, Math.round(Number(seconds) * Number(fps)))
    const start = clamp(Number(from) || 1.35, 1.01, 3)
    const step = ((start - 1) / frames).toFixed(8)
    const h = Math.round(MAX_DIM * 9 / 16 / 2) * 2
    return {
      video: `scale=${MAX_DIM * 2}:-2,zoompan=z='max(zoom-${step},1.0)':d=${frames}:s=${MAX_DIM}x${h}:fps=${fps}`,
      audio: '',
    }
  },

  /** Push in while drifting — the classic documentary move. */
  kenburns: ({ seconds = STILL_SECONDS, fps = 25, to = 1.3 }) => {
    const frames = Math.max(1, Math.round(Number(seconds) * Number(fps)))
    const end = clamp(Number(to) || 1.3, 1.01, 3)
    const step = ((end - 1) / frames).toFixed(8)
    const h = Math.round(MAX_DIM * 9 / 16 / 2) * 2
    return {
      video: `scale=${MAX_DIM * 2}:-2,zoompan=z='min(zoom+${step},${end})':` +
        `x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)*on/${frames}':` +
        `d=${frames}:s=${MAX_DIM}x${h}:fps=${fps}`,
      audio: '',
    }
  },

  /** Drift across the frame, left to right by default. */
  pan: ({ seconds = STILL_SECONDS, fps = 25, direction = 'right' }) => {
    const frames = Math.max(1, Math.round(Number(seconds) * Number(fps)))
    const h = Math.round(MAX_DIM * 9 / 16 / 2) * 2
    const x = direction === 'left' ? `'(iw-iw/zoom)-(iw-iw/zoom)*on/${frames}'` : `'(iw-iw/zoom)*on/${frames}'`
    return {
      video: `scale=${MAX_DIM * 2}:-2,zoompan=z=1.35:x=${x}:y='(ih-ih/zoom)/2':d=${frames}:s=${MAX_DIM}x${h}:fps=${fps}`,
      audio: '',
    }
  },
}

export const EFFECT_NAMES = Object.keys(EFFECTS)

/**
 * Apply an ffmpeg effect, writing the result as a new library document.
 *
 * @param {object} params
 * @param {string} params.key      Document to work from
 * @param {string} params.effect   One of EFFECT_NAMES
 * @returns {Promise<{key: string, seconds: number}>}
 */
async function effect({ key, effect: name, ...options } = {}) {
  if (!key) throw new Error('effect: key is required')
  if (!name) throw new Error(`effect: effect is required — one of ${EFFECT_NAMES.join(', ')}`)

  const build = EFFECTS[name]
  if (!build) throw new Error(`effect: unknown effect "${name}" — try ${EFFECT_NAMES.join(', ')}`)

  const doc = await find(key)
  if (!doc) throw new Error(`effect: no document for key ${key}`)

  const kind = doc.type?.split('/')[0]
  const isStill = kind === 'image'

  if (isStill && !MOTION.has(name)) {
    throw new Error(`effect: "${name}" needs a video; for a still try ${[...MOTION].join(' or ')}`)
  }
  if (!isStill && kind !== 'video') {
    throw new Error(`effect: ${key} is ${doc.type || 'untyped'}, expected image or video`)
  }

  const streams = await probeStreams(doc.source)
  const seconds = options.duration ?? streams.duration ?? STILL_SECONDS
  const chains = build({ ...options, duration: seconds })

  if (!chains.video && !chains.audio) throw new Error(`effect: "${name}" produced no filter`)

  const dataDir = process.env.DATA_DIR || './data'
  const base = path.basename(doc.source, path.extname(doc.source))
  const outPath = path.join(dataDir, `${base}.${name}.mp4`)

  const videoChain = [chains.video, `scale='min(${MAX_DIM},iw)':-2`, 'format=yuv420p']
    .filter(Boolean)
    .join(',')

  const args = ['-y']
  if (isStill) args.push('-loop', '1')
  args.push('-i', doc.source, '-vf', videoChain)

  // Only touch audio if there is any; -map would fail on a silent clip.
  if (streams.hasAudio && chains.audio) args.push('-af', chains.audio)
  if (!streams.hasAudio) args.push('-an')

  if (isStill) args.push('-t', String(options.seconds ?? STILL_SECONDS))

  args.push('-c:v', 'libx264', '-preset', PRESET, '-movflags', '+faststart', outPath)

  console.log(`effect: ${name} on ${doc.key} → ${outPath}`)
  const startedAt = Date.now()
  await runFfmpeg(args)
  const took = (Date.now() - startedAt) / 1000
  const { size } = await fs.stat(outPath)

  await record({
    key: outPath,
    source: outPath,
    name: path.basename(outPath),
    type: 'video/mp4',
    generator: 'effect',
    derivedFrom: [doc.key],
    label: name,
  })
  await connect({ from: doc.key, to: outPath, type: 'derivative', weight: 0.8 })

  console.log(`effect: wrote ${outPath} (${(size / 1048576).toFixed(1)}MB in ${took.toFixed(1)}s)`)
  return { key: outPath, seconds: took, bytes: size }
}

/** atempo is limited to 0.5–2.0 per instance, so chain for larger changes. */
function atempoChain(factor) {
  const parts = []
  let remaining = factor
  while (remaining > 2) { parts.push('atempo=2.0'); remaining /= 2 }
  while (remaining < 0.5) { parts.push('atempo=0.5'); remaining /= 0.5 }
  parts.push(`atempo=${remaining.toFixed(6)}`)
  return parts.join(',')
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args])
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').pop()}`))
      else resolve()
    })
  })
}

export default effect

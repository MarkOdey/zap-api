import { spawn } from 'child_process';

/**
 * Stream facts ffmpeg commands need up front: duration, dimensions, and whether
 * there is any audio — mapping or filtering audio on a silent input fails.
 *
 * `run` is injectable so callers (and tests) can supply the ffprobe output
 * without spawning the binary.
 */
export async function probeStreams(file, { run = spawnProbe } = {}) {
  const raw = await run([
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json', file,
  ]);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { duration: null, hasAudio: false, width: null, height: null };
  }

  const streams = parsed.streams ?? [];
  const video = streams.find(s => s.codec_type === 'video');

  return {
    duration: Number(parsed.format?.duration) || null,
    hasAudio: streams.some(s => s.codec_type === 'audio'),
    width: video?.width ?? null,
    height: video?.height ?? null,
  };
}

/** Duration in seconds, or null. */
export async function probeDuration(file, opts) {
  const { duration } = await probeStreams(file, opts);
  return duration;
}

/**
 * The subset of stream facts writers store on a document: whether it carries
 * audio, plus its duration and dimensions. `explore` records these on video docs
 * so the broadcast can require audio and the selection layer can filter on it.
 */
export async function describeMedia(file, opts) {
  const { duration, hasAudio, width, height } = await probeStreams(file, opts);
  return { duration, hasAudio, width, height };
}

function spawnProbe(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', args);
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', reject);
    proc.on('close', () => resolve(out));
  });
}

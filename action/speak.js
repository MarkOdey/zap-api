import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import find from './find.js';
import record from './record.js';
import connect from './connect.js';
import { synthesize } from '../utils/speech.js';
import { SOUNDTRACK } from '../relation/statement.js';

/** Guard against handing a whole book to the synthesiser. */
const MAX_CHARS = Number(process.env.TTS_MAX_CHARS || 5000);

const BITRATE = process.env.TTS_BITRATE || '128k';

/**
 * Read a text document aloud, storing the result as an audio document.
 *
 * Also links the text to its narration with a `soundtrack` edge, so the text is
 * read aloud when it comes up in playback, and `render` can turn the pair into a
 * video without being told the track.
 *
 * @param {object}   params
 * @param {string}   params.key      Key of a text document
 * @param {boolean} [params.narrate] Link a soundtrack edge back to the text (default true)
 * @returns {Promise<{key: string, seconds: number, characters: number}>}
 */
async function speak({ key, narrate = true } = {}) {
  if (!key) throw new Error('speak: key is required');

  const doc = await find(key);
  if (!doc) throw new Error(`speak: no document for key ${key}`);
  if (!doc.type?.includes('text')) {
    throw new Error(`speak: ${key} is ${doc.type || 'untyped'}, expected text`);
  }

  let text = await fs.readFile(doc.source, 'utf8');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(`speak: ${key} is empty`);

  if (text.length > MAX_CHARS) {
    console.warn(`speak: truncating ${text.length} characters to ${MAX_CHARS}`);
    text = text.slice(0, MAX_CHARS);
  }

  console.log(`speak: synthesising ${text.length} characters from ${doc.key}`);
  const startedAt = Date.now();
  const { pcm, samplingRate, chunks } = await synthesize(text);

  const dataDir = process.env.DATA_DIR || './data';
  const base = path.basename(doc.source, path.extname(doc.source));
  const outPath = path.join(dataDir, `${base}.spoken.mp3`);

  // Pipe the raw float samples straight into ffmpeg rather than staging a WAV.
  await encode(pcm, samplingRate, outPath);

  const took = (Date.now() - startedAt) / 1000;
  const { size } = await fs.stat(outPath);
  const seconds = pcm.length / samplingRate;

  await record({
    key: outPath,
    source: outPath,
    name: path.basename(outPath),
    type: 'audio/mpeg',
    generator: 'speak',
    derivedFrom: [doc.key],
  });

  await connect({ from: doc.key, to: outPath, type: 'derivative', weight: 0.8 });
  if (narrate) {
    await connect({ from: doc.key, to: outPath, type: SOUNDTRACK, weight: 0.9 });
  }

  console.log(
    `speak: wrote ${outPath} — ${seconds.toFixed(1)}s of audio from ${chunks} chunk(s), ` +
    `${(size / 1024).toFixed(0)}KB in ${took.toFixed(1)}s`,
  );
  return { key: outPath, seconds, characters: text.length, chunks, bytes: size };
}

function encode(pcm, samplingRate, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'f32le', '-ar', String(samplingRate), '-ac', '1', '-i', 'pipe:0',
      '-c:a', 'libmp3lame', '-b:a', BITRATE,
      outPath,
    ]);

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').pop()}`));
      else resolve();
    });

    proc.stdin.on('error', reject);
    proc.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}

export default speak;

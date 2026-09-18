import { getPipeline } from './models.js';

/**
 * MMS-TTS is a VITS model: it needs no speaker embeddings, unlike SpeechT5, so a
 * single model id is enough. The family covers many languages — `Xenova/mms-tts-fra`,
 * `-deu`, `-spa` and so on — which is what TTS_MODEL is for.
 */
export const TTS_MODEL = process.env.TTS_MODEL || 'Xenova/mms-tts-eng';

/** Longest text synthesised in one pass; longer input is split on sentences. */
export const CHUNK_CHARS = Number(process.env.TTS_CHUNK_CHARS || 300);

/** Silence inserted between chunks, so sentences do not run together. */
const GAP_SECONDS = Number(process.env.TTS_GAP_SECONDS || 0.25);

export const getSpeaker = () => getPipeline('text-to-speech', TTS_MODEL);

/**
 * Prepare text for a speech model, which reads characters and has no idea what a
 * URL is.
 *
 * Feed items carry addresses, ids and symbols, and MMS-TTS attempts to pronounce
 * all of it. Round-tripped through speech recognition,
 * "Article URL: https://www.koreajoongangdaily.com/business Points: 165 # Comments: 46"
 * came back as "article Earl Hapsil, Corey's uning daily calm museness" — the
 * halting, arrhythmic delivery is the model sounding out character soup.
 */
export function normaliseForSpeech(text) {
  return String(text ?? '')
    // Syndication boilerplate: announcing it adds nothing when read aloud.
    .replace(/\b(Article|Comments)\s+URL\s*:/gi, ' ')
    .replace(/\bPoints\s*:\s*\d+/gi, ' ')
    .replace(/#\s*Comments\s*:\s*\d+/gi, ' ')
    // Addresses. Email first: the bare-domain rule below would otherwise eat the
    // domain half and leave a dangling "a@". Each pattern must stop short of
    // trailing sentence punctuation, or "Read https://x.com/y." loses its full
    // stop along with the link.
    .replace(/\S+@\S*[^\s.,;:!?]/g, ' ')
    .replace(/\bhttps?:\/\/\S*[^\s.,;:!?)\]]/gi, ' ')
    .replace(/\bwww\.\S*[^\s.,;:!?)\]]/gi, ' ')
    .replace(/\b[\w-]+\.(?:com|org|net|io|co\.uk|ca|gov|edu)\b(?:\/\S*[^\s.,;:!?)\]])?/gi, ' ')
    // Symbols that are read as words, or not at all.
    .replace(/(\d)\s*%/g, '$1 percent')
    .replace(/&amp;|&/g, ' and ')
    .replace(/#/g, ' number ')
    .replace(/\bvs\.?\b/gi, 'versus')
    // Anything left that is not speech: brackets, pipes, slashes, stray marks.
    .replace(/[|\\/_*<>[\]{}~^`]+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split text into chunks the model can handle, preferring sentence boundaries and
 * falling back to words so a single long sentence still fits.
 */
export function chunkText(text, limit = CHUNK_CHARS) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];

  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > limit) {
      if (current.trim()) { chunks.push(current.trim()); current = ''; }
      let words = '';
      for (const word of sentence.split(' ')) {
        if ((words + ' ' + word).trim().length > limit) {
          if (words.trim()) chunks.push(words.trim());
          words = word;
        } else {
          words = (words + ' ' + word).trim();
        }
      }
      if (words.trim()) current = words;
      continue;
    }

    if ((current + sentence).length > limit) {
      if (current.trim()) chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Synthesise text to raw mono float32 PCM.
 * @returns {Promise<{pcm: Float32Array, samplingRate: number, chunks: number}>}
 */
export async function synthesize(text) {
  const chunks = chunkText(normaliseForSpeech(text));
  if (chunks.length === 0) throw new Error('speech: nothing to say');

  const speaker = await getSpeaker();
  const parts = [];
  let samplingRate = 16000;

  for (const [i, chunk] of chunks.entries()) {
    const out = await speaker(chunk);
    samplingRate = out.sampling_rate ?? samplingRate;
    parts.push(out.audio);
    if (i < chunks.length - 1) {
      parts.push(new Float32Array(Math.round(samplingRate * GAP_SECONDS)));
    }
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const pcm = new Float32Array(total);
  let offset = 0;
  for (const part of parts) { pcm.set(part, offset); offset += part.length; }

  return { pcm, samplingRate, chunks: chunks.length };
}

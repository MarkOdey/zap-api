import { getPipeline } from './models.js';

/**
 * A small summarisation model — distilbart, roughly 300MB of weights, against the
 * 4.3GB segmentation one.
 *
 * fp32 deliberately. q8 halves the memory but produces garbage here, exactly as it
 * does for segmentation: "Korea raises data breach fines to 10% of revenue to 10%.
 * Korea raisesData breach fines. Korea raisesdata breac". Memory is bounded by
 * running out of process instead.
 */
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL || 'Xenova/distilbart-cnn-6-6';

/** Roughly a sentence or two — this is shown very large by the text player. */
export const MAX_TOKENS = Number(process.env.SUMMARY_MAX_TOKENS || 44);
export const MIN_LENGTH = Number(process.env.SUMMARY_MIN_LENGTH || 8);

/** Below this there is nothing to condense. */
export const MIN_INPUT_CHARS = Number(process.env.SUMMARY_MIN_INPUT || 120);

export const getSummariser = () => getPipeline('summarization', SUMMARY_MODEL);

/**
 * Condense text. Returns null when the input is already short enough to leave be.
 */
export async function summarise(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length < MIN_INPUT_CHARS) return null;

  const model = await getSummariser();
  const [out] = await model(clean, { max_new_tokens: MAX_TOKENS, min_length: MIN_LENGTH });
  const summary = (out?.summary_text ?? '').replace(/\s+/g, ' ').trim();

  // A summary longer than its input, or empty, is not worth keeping.
  if (!summary || summary.length >= clean.length) return null;
  return summary;
}

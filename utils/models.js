import { env, pipeline } from '@huggingface/transformers';

/**
 * Shared model runtime: one pipeline cache for every task, so vision and speech
 * do not each hold their own and `dispose()` releases all of them.
 *
 * Weights download from the Hugging Face Hub on first use and cache on disk. Keep
 * the cache inside the project (not node_modules) so a Docker volume can hold it,
 * or every container start re-downloads ~200MB.
 */
env.cacheDir = process.env.MODEL_CACHE_DIR || './.models';

/**
 * Quantization. Defaults to fp32: q8 was measured to wreck the segmentation masks
 * on this model — a portrait's person mask went from 0.63 to 0.94 coverage,
 * swallowing most of the background. Set MODEL_DTYPE=q8 to trade quality for speed.
 */
export const DTYPE = process.env.MODEL_DTYPE || 'fp32';

/** Loading a pipeline costs seconds, so hold one per task for the process lifetime. */
const pipelines = new Map();

export function getPipeline(task, model, options = {}) {
  const cacheKey = `${task}:${model}`;
  if (!pipelines.has(cacheKey)) {
    console.log(`models: loading ${task} (${model}, ${options.dtype ?? DTYPE})…`);
    pipelines.set(cacheKey, pipeline(task, model, { dtype: DTYPE, ...options }));
  }
  return pipelines.get(cacheKey);
}

/** Release every cached pipeline. Tests need this or the process will not exit. */
export async function dispose() {
  for (const p of pipelines.values()) {
    try { (await p)?.dispose?.(); } catch { /* best effort */ }
  }
  pipelines.clear();
}

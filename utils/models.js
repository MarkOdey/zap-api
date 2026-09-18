import { env, pipeline } from '@huggingface/transformers';

/**
 * Shared model runtime.
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

/**
 * Only one pipeline is kept resident, and it is released once idle.
 *
 * A loaded fp32 segmentation pipeline holds ~4.2GB — measured, and it does not
 * shrink when the job finishes because onnxruntime keeps its arena. Caching two
 * of them (segmentation plus text-to-speech, which the generator alternates
 * between) exceeded the container's memory and the kernel killed the process.
 *
 * Reloading costs a few seconds. The queue runs one job at a time with gaps
 * between them, so that is a much better trade than dying.
 */
const IDLE_MS = Number(process.env.MODEL_IDLE_MS || 90_000);

/**
 * onnxruntime's CPU arena allocator, off by default here.
 *
 * The arena never returns memory to the OS: it grows to the largest activation
 * footprint it has ever needed and keeps it. With images of every shape and size
 * that ratchets upward run after run — analysing a backlog, the process reached
 * 8.4GB after twelve images and the kernel killed it, having started at 4.3GB.
 *
 * Without the arena each run frees its activations, so the process sits at the
 * model's own size no matter how many images go through. Allocation gets slightly
 * slower; staying alive is worth more. Set ONNX_CPU_ARENA=true to restore it.
 */
const SESSION_OPTIONS = { enableCpuMemArena: process.env.ONNX_CPU_ARENA === 'true' };

let current = null;      // { key, promise }
let idleTimer = null;

export async function getPipeline(task, model, options = {}) {
  const key = `${task}:${model}`;

  if (current && current.key !== key) {
    console.log(`models: releasing ${current.key} to make room for ${key}`);
    await release();
  }

  if (!current) {
    console.log(`models: loading ${task} (${model}, ${options.dtype ?? DTYPE})…`);
    current = { key, promise: pipeline(task, model, { dtype: DTYPE, session_options: SESSION_OPTIONS, ...options }) };
  }

  touch();
  return current.promise;
}

/** Restart the idle countdown. unref so a pending release cannot hold the process open. */
function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('models: releasing idle pipeline');
    release().catch(() => {});
  }, IDLE_MS);
  idleTimer.unref?.();
}

async function release() {
  const held = current;
  current = null;
  clearTimeout(idleTimer);
  if (!held) return;
  try {
    (await held.promise)?.dispose?.();
  } catch { /* best effort */ }
}

/** Release whatever is held. Tests need this or the process will not exit. */
export async function dispose() {
  await release();
}

/** For diagnostics: which pipeline is resident, if any. */
export const resident = () => current?.key ?? null;

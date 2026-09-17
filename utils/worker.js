import queue from './queue.js';
import { COMMANDS } from '../action/registry.js';

/**
 * Run at most one queued job per tick.
 *
 * Concurrency is deliberately 1: the vision actions are CPU-bound ONNX inference,
 * and running two at once thrashes rather than parallelizes. Registered on
 * Cognition, which reschedules only after each run settles, so a long job cannot
 * be overlapped by the next tick.
 */
export default async function drainOne() {
  const job = queue.claim();
  if (!job) return;

  const action = COMMANDS[job.action];
  if (!action) {
    queue.settle(job, { error: new Error(`unknown action: ${job.action}`) });
    return;
  }

  console.log(`queue: running ${job.action} (${job.id})`);
  try {
    const result = await action(job.params);
    queue.settle(job, { result });
    console.log(`queue: ${job.action} done in ${job.finishedAt - job.startedAt}ms`);
  } catch (err) {
    queue.settle(job, { error: err });
    console.warn(`queue: ${job.action} failed —`, err.message);
  }
}

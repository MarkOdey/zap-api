import queue from './queue.js';
import { COMMANDS } from '../action/registry.js';

/**
 * Drain the queue.
 *
 * Runs jobs one at a time — concurrency is deliberately 1, because the vision
 * actions are CPU-bound ONNX inference and running two at once thrashes rather
 * than parallelizes.
 *
 * It keeps going while work remains rather than taking one job per tick, so the
 * scheduler's interval only governs how often an *idle* queue is checked. Pacing a
 * backlog by the tick would add that interval between every job.
 */
export default async function drainOne() {
  while (queue.length > 0) {
    const job = queue.claim();
    if (!job) return;
    await run(job);
  }
}

async function run(job) {
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

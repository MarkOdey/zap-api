import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export const STATES = ['queued', 'running', 'done', 'failed', 'cancelled'];

/** Finished jobs kept for the status view before the oldest are dropped. */
const HISTORY_LIMIT = Number(process.env.QUEUE_HISTORY || 50);

/**
 * In-process FIFO job queue.
 *
 * Deliberately not backed by Mongo: the API runs as a single process, so atomic
 * multi-worker claims are not needed, and a job lost on restart costs a button
 * click. `claim()` is the only thing that touches storage — swap it for a
 * findOneAndUpdate against a `jobs` collection to make the queue durable, and
 * nothing else in the system has to move.
 *
 * Emits 'change' with the job on every state transition.
 */
class Queue extends EventEmitter {
  #jobs = [];

  /** Add a job. Returns the job. */
  push(action, params = {}) {
    if (!action) throw new Error('queue: action is required');

    const job = {
      id: randomUUID(),
      action,
      params,
      state: 'queued',
      queuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
    };

    this.#jobs.push(job);
    this.#trim();
    this.emit('change', job);
    return job;
  }

  /** Take the oldest queued job and mark it running, or null if there is none. */
  claim() {
    const job = this.#jobs.find(j => j.state === 'queued');
    if (!job) return null;

    job.state = 'running';
    job.startedAt = Date.now();
    this.emit('change', job);
    return job;
  }

  /** Mark a running job finished. */
  settle(job, { error = null, result = null } = {}) {
    job.state = error ? 'failed' : 'done';
    job.finishedAt = Date.now();
    job.error = error ? String(error.message ?? error) : null;
    job.result = summarize(result);
    this.emit('change', job);
    return job;
  }

  /** Cancel a job that has not started. Running jobs cannot be interrupted. */
  cancel(id) {
    const job = this.#jobs.find(j => j.id === id);
    if (!job || job.state !== 'queued') return null;

    job.state = 'cancelled';
    job.finishedAt = Date.now();
    this.emit('change', job);
    return job;
  }

  /** Everything a newly connected client needs. */
  snapshot() {
    return {
      jobs: this.#jobs.map(j => ({ ...j })),
      pending: this.#jobs.filter(j => j.state === 'queued').length,
      running: this.#jobs.some(j => j.state === 'running'),
    };
  }

  get length() {
    return this.#jobs.filter(j => j.state === 'queued').length;
  }

  /** Drop the oldest finished jobs once history grows past the limit. */
  #trim() {
    const finished = this.#jobs.filter(j => j.state !== 'queued' && j.state !== 'running');
    const excess = finished.length - HISTORY_LIMIT;
    if (excess > 0) {
      const drop = new Set(finished.slice(0, excess));
      this.#jobs = this.#jobs.filter(j => !drop.has(j));
    }
  }

  /** Tests only. */
  clear() {
    this.#jobs = [];
  }
}

/**
 * Keep only a small, serializable summary of an action's return value — some
 * actions resolve with whole Mongo documents, and this crosses a socket.
 */
function summarize(result) {
  if (result === null || result === undefined) return null;
  if (typeof result !== 'object') return result;
  if (Array.isArray(result)) return { count: result.length };

  const out = {};
  for (const [k, v] of Object.entries(result)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.length <= 10 ? v.map(x => (typeof x === 'object' ? '[object]' : x)) : { count: v.length };
  }
  return out;
}

/** One queue per process. */
const queue = new Queue();
export default queue;
export { Queue };

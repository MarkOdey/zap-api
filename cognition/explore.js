import queue from '../utils/queue.js';

/**
 * Periodic library rescan.
 *
 * Enqueues rather than running inline, so a scheduled scan and a user-triggered
 * one share the queue's concurrency-of-1 instead of racing, and both show up in
 * the client's status view. Skips if an explore is already waiting or running,
 * or the 60s tick would pile up scans of a large library.
 */
export default async function exploreTask() {
  const { jobs } = queue.snapshot();
  const active = jobs.some(j => j.action === 'explore' && (j.state === 'queued' || j.state === 'running'));
  if (active) return;

  queue.push('explore');
}

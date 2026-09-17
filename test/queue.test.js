import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import queue, { Queue } from '../utils/queue.js';
import drainOne from '../utils/worker.js';
import Cognition from '../cognition.js';
import { ACTIONS, COMMANDS, describe as describeActions } from '../action/registry.js';

const tick = ms => new Promise(r => setTimeout(r, ms));

describe('queue: basics', () => {
  beforeEach(() => queue.clear());

  it('requires an action', () => {
    assert.throws(() => queue.push(), /action is required/);
  });

  it('pushes a job in the queued state', () => {
    const job = queue.push('explore');
    assert.equal(job.state, 'queued');
    assert.ok(job.id);
    assert.equal(queue.length, 1);
  });

  it('claims in FIFO order', () => {
    queue.push('explore');
    queue.push('isolate', { key: 'a' });
    assert.equal(queue.claim().action, 'explore');
    assert.equal(queue.claim().action, 'isolate');
    assert.equal(queue.claim(), null);
  });

  it('claim marks the job running and drops it from the pending count', () => {
    queue.push('explore');
    const job = queue.claim();
    assert.equal(job.state, 'running');
    assert.ok(job.startedAt);
    assert.equal(queue.length, 0);
  });

  it('settle records success', () => {
    queue.push('explore');
    const job = queue.settle(queue.claim(), { result: { indexed: 4 } });
    assert.equal(job.state, 'done');
    assert.equal(job.error, null);
    assert.deepEqual(job.result, { indexed: 4 });
    assert.ok(job.finishedAt);
  });

  it('settle records failure', () => {
    queue.push('explore');
    const job = queue.settle(queue.claim(), { error: new Error('boom') });
    assert.equal(job.state, 'failed');
    assert.equal(job.error, 'boom');
  });

  it('cancels a queued job but never a running one', () => {
    const a = queue.push('explore');
    assert.equal(queue.cancel(a.id).state, 'cancelled');

    const b = queue.push('isolate');
    queue.claim();
    assert.equal(queue.cancel(b.id), null, 'a running job cannot be cancelled');
    assert.equal(queue.cancel('no-such-id'), null);
  });

  it('skips cancelled jobs when claiming', () => {
    const a = queue.push('explore');
    queue.push('isolate');
    queue.cancel(a.id);
    assert.equal(queue.claim().action, 'isolate');
  });

  it('emits a change on every transition', () => {
    const seen = [];
    const listener = j => seen.push(j.state);
    queue.on('change', listener);

    const job = queue.push('explore');
    queue.claim();
    queue.settle(job, {});
    queue.off('change', listener);

    assert.deepEqual(seen, ['queued', 'running', 'done']);
  });

  it('snapshot reports pending and running', () => {
    queue.push('explore');
    queue.push('isolate');
    queue.claim();

    const snap = queue.snapshot();
    assert.equal(snap.pending, 1);
    assert.equal(snap.running, true);
    assert.equal(snap.jobs.length, 2);
  });

  it('summarizes results rather than shipping whole documents', () => {
    const q = new Queue();
    q.push('find');
    const job = q.settle(q.claim(), {
      result: { key: 'a', nested: { huge: true }, list: [1, 2, 3] },
    });
    assert.equal(job.result.key, 'a');
    assert.equal(job.result.nested, undefined, 'nested objects are dropped');
    assert.deepEqual(job.result.list, [1, 2, 3]);
  });
});

describe('queue: worker', () => {
  beforeEach(() => queue.clear());

  it('does nothing when the queue is empty', async () => {
    await assert.doesNotReject(() => drainOne());
  });

  it('fails a job whose action does not exist', async () => {
    const job = queue.push('not-a-real-action');
    await drainOne();
    assert.equal(job.state, 'failed');
    assert.match(job.error, /unknown action/);
  });

  it('runs one job per call, not the whole queue', async () => {
    queue.push('not-a-real-action');
    queue.push('not-a-real-action');
    await drainOne();
    assert.equal(queue.length, 1, 'the second job should still be waiting');
  });
});

describe('registry', () => {
  it('exposes a function for every action', () => {
    for (const [name, spec] of Object.entries(ACTIONS)) {
      assert.equal(typeof spec.fn, 'function', `${name} should have a fn`);
      assert.ok(Array.isArray(spec.params), `${name} should declare params`);
    }
  });

  it('COMMANDS mirrors ACTIONS', () => {
    assert.deepEqual(Object.keys(COMMANDS).sort(), Object.keys(ACTIONS).sort());
  });

  it('marks the slow actions queueable', () => {
    for (const name of ['explore', 'isolate', 'compose']) {
      assert.equal(ACTIONS[name].queueable, true, `${name} should be queueable`);
    }
    assert.equal(ACTIONS.find.queueable, false);
  });

  it('describe() is serializable and complete', () => {
    const described = describeActions();
    assert.equal(described.length, Object.keys(ACTIONS).length);
    assert.doesNotThrow(() => JSON.stringify(described));
    assert.ok(described.every(a => a.name && Array.isArray(a.params)));
  });
});

describe('cognition: status and non-overlap', () => {
  it('reports status for every registered task', () => {
    const c = new Cognition();
    c.register('a', async () => {}, 1000);
    c.register('b', async () => {}, 2000);

    const status = c.status();
    assert.equal(status.length, 2);
    assert.deepEqual(status.map(t => t.name), ['a', 'b']);
    assert.equal(status[0].runs, 0);
    assert.equal(status[0].running, false);
  });

  // Regression: setInterval fired regardless of whether the previous run had
  // finished, so a task slower than its interval piled up overlapping runs.
  it('never overlaps a task slower than its interval', async () => {
    const c = new Cognition();
    let concurrent = 0;
    let maxConcurrent = 0;

    c.register('slow', async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await tick(60);
      concurrent--;
    }, 10);

    c.start();
    await tick(250);
    c.stop();

    assert.equal(maxConcurrent, 1, `expected no overlap, saw ${maxConcurrent} concurrent runs`);
  });

  it('records run count, duration and errors', async () => {
    const c = new Cognition();
    c.register('ok',  async () => { await tick(5); }, 20);
    c.register('bad', async () => { throw new Error('nope'); }, 20);
    c.start();
    await tick(90);
    c.stop();

    const [ok, bad] = c.status();
    assert.ok(ok.runs >= 2, `expected repeated runs, got ${ok.runs}`);
    assert.equal(ok.lastError, null);
    assert.ok(ok.lastDurationMs >= 0);
    assert.equal(bad.lastError, 'nope');
    assert.ok(bad.runs >= 2, 'a throwing task keeps being rescheduled');
  });

  it('clears nextRunAt on stop', async () => {
    const c = new Cognition();
    c.register('a', async () => {}, 50);
    c.start();
    await tick(20);
    c.stop();
    assert.equal(c.status()[0].nextRunAt, null);
  });
});

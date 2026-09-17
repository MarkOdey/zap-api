import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import Cognition from '../cognition.js';

const tick = ms => new Promise(r => setTimeout(r, ms));

describe('cognition', () => {
  it('runs a registered task immediately on start', async () => {
    const c = new Cognition();
    let runs = 0;
    c.register('counter', async () => { runs++; }, 10_000);
    c.start();
    await tick(20);
    c.stop();
    assert.equal(runs, 1);
  });

  it('repeats a task on its interval', async () => {
    const c = new Cognition();
    let runs = 0;
    c.register('counter', async () => { runs++; }, 20);
    c.start();
    await tick(110);
    c.stop();
    assert.ok(runs >= 3, `expected repeated runs, got ${runs}`);
  });

  it('stop() halts further runs', async () => {
    const c = new Cognition();
    let runs = 0;
    c.register('counter', async () => { runs++; }, 20);
    c.start();
    await tick(50);
    c.stop();
    const atStop = runs;
    await tick(80);
    assert.equal(runs, atStop);
  });

  it('a throwing task is contained and does not stop the others', async () => {
    const c = new Cognition();
    let healthy = 0;
    c.register('boom', async () => { throw new Error('expected failure'); }, 20);
    c.register('healthy', async () => { healthy++; }, 20);
    c.start();
    await tick(80);
    c.stop();
    assert.ok(healthy >= 2, `healthy task should keep running, got ${healthy}`);
  });

  it('stop() is safe to call when never started', () => {
    const c = new Cognition();
    c.register('noop', async () => {}, 20);
    assert.doesNotThrow(() => c.stop());
  });
});

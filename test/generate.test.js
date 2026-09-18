import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import queue from '../utils/queue.js';
import generateTask from '../cognition/generate.js';
import MongoConnexion from '../utils/MongoConnexion.js';

const NO_DB = !process.env.MONGO_URL;

describe('generate (needs MONGO_URL)', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  let col;

  before(async () => {
    const db = await MongoConnexion.db();
    col = db.collection('data');
    await col.deleteMany({ key: /^gentest\// });
    await col.insertMany([
      { key: 'gentest/a.jpg', source: 'gentest/a.jpg', name: 'a.jpg', type: 'image/jpeg', weight: 0.5 },
      { key: 'gentest/b.jpg', source: 'gentest/b.jpg', name: 'b.jpg', type: 'image/jpeg', weight: 0.5 },
      { key: 'gentest/c.jpg', source: 'gentest/c.jpg', name: 'c.jpg', type: 'image/jpeg', weight: 0.5 },
      { key: 'gentest/d.mp4', source: 'gentest/d.mp4', name: 'd.mp4', type: 'video/mp4', weight: 0.5 },
      { key: 'gentest/e.mp3', source: 'gentest/e.mp3', name: 'e.mp3', type: 'audio/mpeg', weight: 0.5 },
      { key: 'gentest/f.txt', source: 'gentest/f.txt', name: 'f.txt', type: 'text/plain', weight: 0.5 },
    ]);
  });

  after(async () => {
    await col.deleteMany({ key: /^gentest\// });
    queue.clear();
    await MongoConnexion.close();
  });

  beforeEach(() => queue.clear());

  it('queues exactly one job when idle', async () => {
    await generateTask();
    assert.equal(queue.snapshot().jobs.length, 1);
  });

  // The queue is concurrency-1; queuing behind in-flight work would starve
  // anything the user triggers by hand.
  it('queues nothing while a job is running', async () => {
    queue.push('explore');
    queue.claim();
    await generateTask();
    assert.equal(queue.snapshot().jobs.length, 1, 'should not have added a second job');
  });

  it('queues nothing while a job is merely waiting', async () => {
    queue.push('explore');
    await generateTask();
    assert.equal(queue.snapshot().jobs.length, 1);
  });

  it('only chooses actions that exist and are queueable', async () => {
    const { ACTIONS } = await import('../action/registry.js');
    for (let i = 0; i < 25; i++) {
      queue.clear();
      await generateTask();
      const [job] = queue.snapshot().jobs;
      if (!job) continue;
      assert.ok(ACTIONS[job.action], `${job.action} should be a registered action`);
      assert.equal(ACTIONS[job.action].queueable, true, `${job.action} should be queueable`);
    }
  });

  it('always supplies the arguments the chosen action needs', async () => {
    const required = { speak: ['key'], isolate: ['key'], effect: ['key', 'effect'], render: ['visual', 'audio'], montage: ['keys'] };
    for (let i = 0; i < 25; i++) {
      queue.clear();
      await generateTask();
      const [job] = queue.snapshot().jobs;
      if (!job) continue;
      for (const field of required[job.action] ?? []) {
        assert.ok(job.params[field] !== undefined, `${job.action} needs ${field}, got ${JSON.stringify(job.params)}`);
      }
    }
  });

  // A transformation's output is itself transformable; feeding results back in
  // compounds without bound.
  it('never uses a generated document as input', async () => {
    await col.insertOne({
      key: 'gentest/derived.mp4', source: 'gentest/derived.mp4', name: 'derived.mp4',
      type: 'video/mp4', weight: 0.5, generator: 'effect', derivedFrom: ['gentest/d.mp4'],
    });

    for (let i = 0; i < 30; i++) {
      queue.clear();
      await generateTask();
      const [job] = queue.snapshot().jobs;
      if (!job) continue;
      const inputs = Object.values(job.params).flat().filter(v => typeof v === 'string');
      assert.ok(!inputs.includes('gentest/derived.mp4'),
        `picked a generated document as input: ${JSON.stringify(job.params)}`);
    }

    await col.deleteOne({ key: 'gentest/derived.mp4' });
  });

  it('stops once the generated ceiling is reached', async () => {
    const previous = process.env.GENERATE_MAX_DOCS;
    process.env.GENERATE_MAX_DOCS = '0';
    try {
      const fresh = (await import(`../cognition/generate.js?ceiling=${Date.now()}`)).default;
      queue.clear();
      await fresh();
      assert.equal(queue.snapshot().jobs.length, 0, 'should queue nothing at the ceiling');
    } finally {
      if (previous === undefined) delete process.env.GENERATE_MAX_DOCS;
      else process.env.GENERATE_MAX_DOCS = previous;
    }
  });

  it('can be switched off', async () => {
    const previous = process.env.GENERATE_ENABLED;
    process.env.GENERATE_ENABLED = 'false';
    try {
      const fresh = (await import(`../cognition/generate.js?off=${Date.now()}`)).default;
      queue.clear();
      await fresh();
      assert.equal(queue.snapshot().jobs.length, 0);
    } finally {
      if (previous === undefined) delete process.env.GENERATE_ENABLED;
      else process.env.GENERATE_ENABLED = previous;
    }
  });
});

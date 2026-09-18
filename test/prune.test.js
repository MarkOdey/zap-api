import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import MongoConnexion from '../utils/MongoConnexion.js';

const NO_DB = !process.env.MONGO_URL;

describe('prune (needs MONGO_URL)', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  let prune;
  let col;
  let edgeCol;
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zap-prune-'));
    prune = (await import('../action/prune.js')).default;
    const db = await MongoConnexion.db();
    col = db.collection('data');
    edgeCol = db.collection('edges');
  });

  after(async () => {
    await col.deleteMany({ key: /^prunetest\// });
    await edgeCol.deleteMany({ key: /^prunetest/ });
    await fs.rm(dir, { recursive: true, force: true });
    await MongoConnexion.close();
  });

  /** A document with a real file of the given size. */
  async function make({ name, kb = 16, weight = 0.5, generator = null, writeFile = true }) {
    const source = path.join(dir, name);
    if (writeFile) await fs.writeFile(source, Buffer.alloc(kb * 1024, 1));
    const doc = {
      key: `prunetest/${name}`, source, name, type: 'image/jpeg', weight,
      ...(generator ? { generator, derivedFrom: ['prunetest/origin'] } : {}),
    };
    await col.insertOne(doc);
    return doc;
  }

  beforeEach(async () => {
    await col.deleteMany({ key: /^prunetest\// });
    await edgeCol.deleteMany({ key: /^prunetest/ });
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  });

  const alive = (key) => col.countDocuments({ key });

  // The whole point: the budget governs what the machine made, never uploads.
  it('never deletes an original, however low its score or tight the budget', async () => {
    await make({ name: 'mine-a.jpg', kb: 500, weight: 0 });
    await make({ name: 'mine-b.jpg', kb: 500, weight: 0 });
    await make({ name: 'made.jpg', kb: 500, weight: 0, generator: 'effect' });

    await prune({ budgetMb: 0 });

    assert.equal(await alive('prunetest/mine-a.jpg'), 1, 'uploads must survive');
    assert.equal(await alive('prunetest/mine-b.jpg'), 1, 'uploads must survive');
    assert.equal(await alive('prunetest/made.jpg'), 0, 'generated media is what the budget governs');
  });

  it('evicts the lowest-scoring generated media first', async () => {
    await make({ name: 'loved.jpg', kb: 400, weight: 0.99, generator: 'effect' });
    await make({ name: 'meh.jpg', kb: 400, weight: 0.50, generator: 'effect' });
    await make({ name: 'hated.jpg', kb: 400, weight: 0.01, generator: 'effect' });

    // Room for roughly two of the three.
    await prune({ budgetMb: 0.8 });

    assert.equal(await alive('prunetest/hated.jpg'), 0, 'the least liked should go first');
    assert.equal(await alive('prunetest/loved.jpg'), 1, 'the most liked should be kept');
  });

  it('stops as soon as it is under budget', async () => {
    for (let i = 0; i < 6; i++) await make({ name: `g${i}.jpg`, kb: 200, weight: i / 10, generator: 'effect' });
    const report = await prune({ budgetMb: 1 });
    const left = await col.countDocuments({ key: /^prunetest\/g/ });
    assert.ok(left >= 4, `should stop once under budget, ${left} left`);
    assert.ok(report.freedMb > 0);
  });

  it('deletes the file, not just the record', async () => {
    const doc = await make({ name: 'gone.jpg', kb: 300, weight: 0.01, generator: 'effect' });
    await prune({ budgetMb: 0 });
    await assert.rejects(() => fs.access(doc.source), 'the file should be removed too');
  });

  it('removes a document whose file has vanished', async () => {
    await make({ name: 'ghost.jpg', kb: 10, weight: 0.9, writeFile: false });
    await prune({});
    assert.equal(await alive('prunetest/ghost.jpg'), 0, 'an orphan stalls playback and must go');
  });

  it('removes a document that no longer satisfies the model', async () => {
    const doc = await make({ name: 'broken.jpg', kb: 10 });
    await col.updateOne({ key: doc.key }, { $set: { type: '' } });
    await prune({});
    assert.equal(await alive('prunetest/broken.jpg'), 0);
  });

  it('removes edges pointing at documents that are gone', async () => {
    await make({ name: 'here.jpg', kb: 10 });
    await edgeCol.insertOne({ key: 'prunetest-dangling', from: 'prunetest/here.jpg', to: 'prunetest/nowhere.jpg', type: 'theme', weight: 0.9 });
    await prune({});
    assert.equal(await edgeCol.countDocuments({ key: 'prunetest-dangling' }), 0);
  });

  // Provenance is not an opinion to be voted away.
  it('spares derivative and soundtrack edges however low their weight', async () => {
    await make({ name: 'src.jpg', kb: 10 });
    await make({ name: 'out.jpg', kb: 10, generator: 'isolate' });
    await edgeCol.insertMany([
      { key: 'prunetest-deriv', from: 'prunetest/src.jpg', to: 'prunetest/out.jpg', type: 'derivative', weight: 0.001 },
      { key: 'prunetest-track', from: 'prunetest/src.jpg', to: 'prunetest/out.jpg', type: 'soundtrack', weight: 0.001 },
      { key: 'prunetest-weak', from: 'prunetest/src.jpg', to: 'prunetest/out.jpg', type: 'theme', weight: 0.001 },
    ]);

    await prune({});

    assert.equal(await edgeCol.countDocuments({ key: 'prunetest-deriv' }), 1, 'provenance must survive');
    assert.equal(await edgeCol.countDocuments({ key: 'prunetest-track' }), 1, 'pairings must survive');
    assert.equal(await edgeCol.countDocuments({ key: 'prunetest-weak' }), 0, 'weak associations may go');
  });

  it('changes nothing on a dry run', async () => {
    await make({ name: 'safe.jpg', kb: 400, weight: 0.01, generator: 'effect' });
    const report = await prune({ dryRun: true, budgetMb: 0 });
    assert.ok(report.evicted > 0, 'it should say what it would do');
    assert.equal(await alive('prunetest/safe.jpg'), 1, 'but delete nothing');
  });

  it('does nothing when comfortably under budget', async () => {
    await make({ name: 'small.jpg', kb: 10, weight: 0.5, generator: 'effect' });
    const report = await prune({ budgetMb: 1000 });
    assert.equal(report.evicted, 0);
    assert.equal(report.freedMb, 0);
    assert.equal(await alive('prunetest/small.jpg'), 1);
  });
});

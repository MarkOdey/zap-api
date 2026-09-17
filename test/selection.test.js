import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import MongoConnexion from '../utils/MongoConnexion.js';

// Needs a database: these pin query behaviour, which cannot be faked.
//   MONGO_URL=mongodb://localhost:27021/zap-test npm test
const NO_DB = !process.env.MONGO_URL;
const COLLECTION = 'selection_test_data';
const ITERATIONS = 200;

// One close for the whole file: the shared client keeps the event loop alive,
// and closing it inside a describe strands any later one that reconnects.
after(() => (NO_DB ? undefined : MongoConnexion.close()));

describe('play: weighted selection spread (needs MONGO_URL)', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  let col;

  before(async () => {
    const db = await MongoConnexion.db();
    col = db.collection(COLLECTION);
    await col.deleteMany({});

    // Insert order defeats the old findOne(): the highest weight comes first, so
    // almost nothing after it is a left-to-right maximum. Weights are spread
    // across the whole range, as a real library's are — clustering them makes
    // the top document win every draw above the cluster and skews the test.
    const docs = [{ key: 'k0', weight: 0.97 }];
    for (let i = 1; i < 40; i++) docs.push({ key: `k${i}`, weight: 0.02 + (i / 40) * 0.93 });
    await col.insertMany(docs);
  });

  after(() => col.drop().catch(() => {}));

  /** The patched selection from action/play.js. */
  async function pick() {
    const [hit] = await col.aggregate([
      { $match: { weight: { $gt: Math.random() } } },
      { $sample: { size: 1 } },
    ]).toArray();
    if (hit) return hit;
    const [any] = await col.aggregate([{ $sample: { size: 1 } }]).toArray();
    return any;
  }

  /** The original, for contrast — documents the bug this test guards. */
  const pickOld = async () =>
    (await col.findOne({ weight: { $gt: Math.random() } })) ?? (await col.findOne({}));

  it('reaches most of the collection', async () => {
    const seen = new Set();
    for (let i = 0; i < ITERATIONS; i++) seen.add((await pick()).key);
    assert.ok(seen.size > 25, `expected wide coverage of 40 docs, saw ${seen.size}`);
  });

  it('does not concentrate on a handful of documents', async () => {
    const counts = new Map();
    for (let i = 0; i < ITERATIONS; i++) {
      const k = (await pick()).key;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const top3 = [...counts.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    assert.ok(top3 / ITERATIONS < 0.35, `top 3 documents took ${Math.round((top3 / ITERATIONS) * 100)}% of picks`);
  });

  it('always returns a document, even when the threshold beats every weight', async () => {
    for (let i = 0; i < 20; i++) assert.ok((await pick())?.key, 'selection must never return null');
  });

  // Regression: findOne() has no sort, so it returned the first match in natural
  // order. Only left-to-right maxima were reachable — 4 of 47 in the real library.
  it('the old findOne approach demonstrably could not', async () => {
    const seen = new Set();
    for (let i = 0; i < ITERATIONS; i++) seen.add((await pickOld()).key);
    assert.ok(seen.size < 10,
      `the old query should be badly concentrated (that was the bug), saw ${seen.size}`);
  });
});

describe('explore: weights survive a rescan (needs MONGO_URL)', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  it('sets weight on insert only, so likes are not wiped', async () => {
    const db = await MongoConnexion.db();
    const col = db.collection('explore_weight_test');
    await col.deleteMany({});

    const doc = { key: 'w1', source: 'w1', name: 'w1.jpg', type: 'image/jpeg' };

    // What explore.js now does.
    const upsert = async (weight) => {
      await col.updateOne({ key: doc.key }, { $set: doc, $setOnInsert: { weight } }, { upsert: true });
    };

    await upsert(0.2);
    await col.updateOne({ key: 'w1' }, { $set: { weight: 0.99 } }); // a like
    await upsert(0.7);                                             // a later rescan

    assert.equal((await col.findOne({ key: 'w1' })).weight, 0.99, 'the like must survive');
    await col.drop().catch(() => {});
  });
});

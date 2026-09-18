import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import analyse from '../action/analyse.js';
import { SUBJECT } from '../relation/statement.js';
import TYPES from '../relation/statement.js';
import MongoConnexion from '../utils/MongoConnexion.js';

// Rejects before a model loads or a database is touched.
describe('analyse: validation', () => {
  it('requires an image key, and a string one', async () => {
    await assert.rejects(() => analyse({}), /key must be an image document key/);
    await assert.rejects(() => analyse({ key: true }), /key must be an image document key/);
    await assert.rejects(() => analyse({ key: '  ' }), /key must be an image document key/);
    await assert.rejects(() => analyse(), /key must be an image document key/);
  });
});

describe('subject edges', () => {
  // Kept out of the default export so relate cannot invent one at random: an
  // edge saying two things share a subject must be earned, not rolled.
  it('are not among the types relate picks randomly', () => {
    assert.ok(!Object.values(TYPES).includes(SUBJECT));
    assert.equal(SUBJECT, 'subject');
  });
});

const NO_DB = !process.env.MONGO_URL;

describe('relate: linking by subject (needs MONGO_URL)', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  let relateTask;
  let col;
  let edges;

  before(async () => {
    relateTask = (await import('../cognition/relate.js')).default;
    const db = await MongoConnexion.db();
    col = db.collection('data');
    edges = db.collection('edges');
  });

  after(async () => {
    await col.deleteMany({ key: /^subjtest\// });
    await edges.deleteMany({ $or: [{ from: /^subjtest\// }, { to: /^subjtest\// }] });
    await MongoConnexion.close();
  });

  beforeEach(async () => {
    await col.deleteMany({});
    await edges.deleteMany({});
  });

  const make = (name, subjects) => ({
    key: `subjtest/${name}`, source: `subjtest/${name}`, name, type: 'image/jpeg', weight: 0.5,
    labels: subjects.map(s => s.label), subjects,
  });

  it('links two documents that share a prominent subject', async () => {
    await col.insertMany([
      make('a.jpg', [{ label: 'bicycle', coverage: 0.4, count: 1, score: 0.9 }]),
      make('b.jpg', [{ label: 'bicycle', coverage: 0.3, count: 1, score: 0.9 }]),
    ]);

    await relateTask();

    const edge = await edges.findOne({ type: SUBJECT });
    assert.ok(edge, 'a subject edge should have been drawn');
    assert.ok([edge.from, edge.to].every(k => k.startsWith('subjtest/')));
  });

  it('weights the link by the weaker of the two associations', async () => {
    await col.insertMany([
      make('big.jpg', [{ label: 'car', coverage: 0.9, count: 1, score: 0.9 }]),
      make('small.jpg', [{ label: 'car', coverage: 0.06, count: 1, score: 0.9 }]),
    ]);

    await relateTask();

    const edge = await edges.findOne({ type: SUBJECT });
    assert.ok(edge, 'should link');
    // min(0.9, 0.06) * 2 = 0.12, floored at 0.2 — a corner appearance is a weak link.
    assert.ok(edge.weight <= 0.3, `a marginal subject should link weakly, got ${edge.weight}`);
  });

  it('does not link documents whose subjects do not overlap', async () => {
    await col.insertMany([
      make('cat.jpg', [{ label: 'cat', coverage: 0.5, count: 1, score: 0.9 }]),
      make('boat.jpg', [{ label: 'boat', coverage: 0.5, count: 1, score: 0.9 }]),
    ]);

    await relateTask();

    assert.equal(await edges.countDocuments({ type: SUBJECT }), 0, 'nothing is shared');
  });

  it('ignores a subject that barely appears', async () => {
    await col.insertMany([
      make('speck1.jpg', [{ label: 'kite', coverage: 0.001, count: 1, score: 0.9 }]),
      make('speck2.jpg', [{ label: 'kite', coverage: 0.001, count: 1, score: 0.9 }]),
    ]);

    await relateTask();

    assert.equal(await edges.countDocuments({ type: SUBJECT }), 0,
      'a handful of pixels is not a shared subject');
  });

  // A library with nothing analysed must still build a graph.
  it('falls back to random pairing when nothing is analysed', async () => {
    await col.insertMany([
      { key: 'subjtest/x.jpg', source: 'x', name: 'x', type: 'image/jpeg', weight: 0.5 },
      { key: 'subjtest/y.jpg', source: 'y', name: 'y', type: 'image/jpeg', weight: 0.5 },
    ]);

    await relateTask();

    const edge = await edges.findOne({});
    assert.ok(edge, 'an edge should still be drawn');
    assert.notEqual(edge.type, SUBJECT, 'but not one claiming a shared subject');
  });
});

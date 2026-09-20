import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { selectionPipeline, fallbackPipeline, traversalPipeline, HALF_LIFE_DAYS, RECENCY_FLOOR } from '../utils/selection.js';
import MongoConnexion from '../utils/MongoConnexion.js';

// Each test file runs in its own process and shares one MongoDB server, so they
// would otherwise collide: a file that counts documents sees another file's
// fixtures. MONGO_DB overrides the database taken from MONGO_URL, giving this
// file a database of its own.
process.env.MONGO_DB = 'zap-test-selection';


const json = (v) => JSON.stringify(v);

describe('selection: pipeline shape', () => {
  it('filters on weight, draws one, and cleans up after itself', () => {
    const p = selectionPipeline({ threshold: 0.4 });
    assert.deepEqual(p[0], { $match: { weight: { $gt: 0.4 } } });
    assert.ok(p.some(stage => stage.$limit === 1));
    assert.ok(p.some(stage => Array.isArray(stage.$unset) && stage.$unset.includes('_score')),
      'temporary fields must not reach the caller');
  });

  it('sorts by the draw, descending — the largest key wins', () => {
    const sort = selectionPipeline().find(s => s.$sort);
    assert.deepEqual(sort.$sort, { _draw: -1 });
  });

  it('raises a random number to 1/score, not score itself', () => {
    // Efraimidis-Spirakis: random^(1/score). Getting this inverted would favour
    // the least liked and least recent documents.
    const draw = json(selectionPipeline().find(s => s.$addFields?._draw));
    assert.ok(draw.includes('"$rand"'));
    assert.ok(draw.includes('"$divide":[1,"$_score"]'.replace(/\s/g, '')) || draw.includes('$divide'));
    const stage = selectionPipeline().find(s => s.$addFields?._draw);
    assert.deepEqual(stage.$addFields._draw.$pow[1], { $divide: [1, '$_score'] });
  });

  it('drops the weight threshold in the fallback', () => {
    assert.deepEqual(fallbackPipeline()[0], { $match: { weight: { $gt: -1 } } });
  });

  it('uses a fresh threshold each call, so the draw is not fixed', () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(selectionPipeline()[0].$match.weight.$gt);
    assert.ok(seen.size > 1, 'threshold should vary between calls');
  });
});

describe('selection: extra match conditions', () => {
  it('leaves the match untouched when none are given', () => {
    assert.deepEqual(selectionPipeline({ threshold: 0.4 })[0], { $match: { weight: { $gt: 0.4 } } });
  });

  it('merges extra conditions alongside the weight threshold', () => {
    const m = selectionPipeline({ threshold: 0.4, match: { type: /^video\//, hasAudio: true } })[0].$match;
    assert.deepEqual(m.weight, { $gt: 0.4 }, 'weight threshold must survive');
    assert.equal(m.hasAudio, true, 'extra condition must be present');
    assert.ok(m.type instanceof RegExp, 'extra regex condition must be present');
  });

  it('keeps both the key restriction and the extra conditions', () => {
    const m = selectionPipeline({ keys: ['a', 'b'], match: { hasAudio: true } })[0].$match;
    assert.deepEqual(m.key, { $in: ['a', 'b'] });
    assert.equal(m.hasAudio, true);
  });

  it('passes match through the fallback and traversal pipelines', () => {
    assert.equal(fallbackPipeline({ match: { hasAudio: true } })[0].$match.hasAudio, true);
    assert.equal(traversalPipeline(['a'], { match: { hasAudio: true } })[0].$match.hasAudio, true);
  });
});

describe('selection: recency term', () => {
  const scoreStage = (opts) => selectionPipeline(opts).find(s => s.$addFields?._score);

  it('multiplies weight by a decay based on document age', () => {
    const body = json(scoreStage());
    assert.ok(body.includes('$weight'), 'weight must still count');
    assert.ok(body.includes('$toDate'), 'age comes from the document id');
    assert.ok(body.includes('$pow'), 'decay is exponential');
  });

  it('floors the decay so nothing becomes unreachable', () => {
    // Without a floor, a one-day half-life makes a month-old item 2^-30 as
    // likely as a fresh one — never.
    const body = json(scoreStage());
    assert.ok(body.includes('$max'), 'the decay must be floored');
    assert.ok(RECENCY_FLOOR > 0 && RECENCY_FLOOR < 1, `floor should be a fraction, got ${RECENCY_FLOOR}`);
  });

  it('drops the decay entirely at strength 0', () => {
    const body = json(scoreStage({ strength: 0 }));
    assert.ok(!body.includes('$toDate'), 'age should not be consulted when disabled');
  });

  it('never divides by zero, however small the score', () => {
    const body = json(scoreStage());
    assert.ok(/1e-6|0\.000001/.test(body), 'score must be floored above zero');
  });

  it('has a sane default half-life', () => {
    assert.ok(HALF_LIFE_DAYS > 0 && HALF_LIFE_DAYS <= 30);
  });

  it('tolerates a zero half-life instead of dividing by it', () => {
    assert.doesNotThrow(() => selectionPipeline({ halfLifeDays: 0 }));
  });
});

const NO_DB = !process.env.MONGO_URL;

describe('selection: behaviour against a database', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  after(() => MongoConnexion.close());

  it('favours recent documents while leaving old ones reachable', async () => {
    const db = await MongoConnexion.db();
    const col = db.collection('seltest');
    await col.deleteMany({});

    // Same weight throughout, so any difference is recency alone.
    const { ObjectId } = await import('mongodb');
    const day = 86_400_000;
    const docs = [];
    for (let i = 0; i < 20; i++) {
      docs.push({
        _id: ObjectId.createFromTime(Math.floor((Date.now() - i * day) / 1000)),
        key: `seltest/${i}`,
        weight: 0.9,
        ageDays: i,
      });
    }
    await col.insertMany(docs);

    const counts = new Map();
    for (let i = 0; i < 300; i++) {
      const [hit] = await col.aggregate(selectionPipeline({ threshold: 0 })).toArray();
      counts.set(hit.ageDays, (counts.get(hit.ageDays) ?? 0) + 1);
    }

    const fresh = [...counts].filter(([age]) => age <= 2).reduce((n, [, c]) => n + c, 0);
    const stale = [...counts].filter(([age]) => age >= 10).reduce((n, [, c]) => n + c, 0);

    assert.ok(fresh > stale * 1.5, `recent should win clearly: ${fresh} vs ${stale}`);
    assert.ok(stale > 0, 'old documents must still be reachable, not silenced');
    assert.ok(counts.size >= 10, `coverage should stay broad, saw ${counts.size} of 20`);

    await col.drop().catch(() => {});
  });
});

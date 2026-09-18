import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import adjust, { ADJUSTMENT_NAMES } from '../action/adjust.js';
import effect, { EFFECT_NAMES } from '../action/effect.js';
import MongoConnexion from '../utils/MongoConnexion.js';

import { after } from 'node:test';
after(() => (process.env.MONGO_URL ? MongoConnexion.close() : undefined));

describe('adjust: registry of adjustments', () => {
  it('offers the documented set', () => {
    for (const name of ['blur', 'sharpen', 'greyscale', 'negate', 'colour', 'tint', 'gamma', 'posterize', 'bloom', 'flip', 'flop', 'rotate', 'square']) {
      assert.ok(ADJUSTMENT_NAMES.includes(name), `${name} should be available`);
    }
  });
});

// These reject before a file is read or a database is touched.
describe('adjust: validation', () => {
  it('requires a key, and a string one', async () => {
    await assert.rejects(() => adjust({}), /key must be an image document key/);
    await assert.rejects(() => adjust({ key: true, adjust: 'blur' }), /key must be an image/);
    await assert.rejects(() => adjust({ key: '  ', adjust: 'blur' }), /key must be an image/);
  });

  it('requires an adjustment', async () => {
    await assert.rejects(() => adjust({ key: 'data/a.jpg' }), /adjust is required/);
  });

  it('names the alternatives when given an unknown adjustment', async () => {
    await assert.rejects(
      () => adjust({ key: 'data/a.jpg', adjust: 'nope' }),
      (err) => err.message.includes('unknown adjustment') && err.message.includes('greyscale'),
    );
  });
});

describe('effect: motion effects for stills', () => {
  it('offers push in, pull back, drift and the combined move', () => {
    for (const name of ['zoom', 'zoomout', 'pan', 'kenburns']) {
      assert.ok(EFFECT_NAMES.includes(name), `${name} should be available`);
    }
  });

  // Needs a database: whether the key is a still is only known after looking the
  // document up. The fixture is inserted here rather than relying on whatever
  // happens to be in the library, so the test does not depend on its contents.
  it('still refuses a video-only effect on an image, naming what works',
    { skip: !process.env.MONGO_URL && 'MONGO_URL not set' }, async () => {
      const db = await MongoConnexion.db();
      const col = db.collection('data');
      const key = 'adjusttest/still.jpg';
      await col.deleteMany({ key });
      await col.insertOne({ key, source: key, name: 'still.jpg', type: 'image/jpeg', weight: 0.5 });

      try {
        await assert.rejects(
          () => effect({ key, effect: 'reverse' }),
          (err) => /needs a video/.test(err.message) && /zoom/.test(err.message),
        );
      } finally {
        await col.deleteMany({ key });
      }
    });

  it('names the alternatives when given an unknown effect', async () => {
    await assert.rejects(
      () => effect({ key: 'data/a.mp4', effect: 'nope' }),
      (err) => err.message.includes('unknown effect') && err.message.includes('kenburns'),
    );
  });
});

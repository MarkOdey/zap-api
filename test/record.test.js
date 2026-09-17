import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import record from '../action/record.js';
import find from '../action/find.js';
import MongoConnexion from '../utils/MongoConnexion.js';

// record() validates before it opens a connection, so these need no database.
describe('record: validation gate (no DB required)', () => {
  it('rejects a document with no key', async () => {
    await assert.rejects(() => record({ source: 'data/a.mp4' }), /no key specified/);
    await assert.rejects(() => record({}), /no key specified/);
    await assert.rejects(() => record(null), /no key specified/);
  });

  it('rejects a document that cannot be made to conform', async () => {
    await assert.rejects(
      () => record({ key: 'data/a.mp4', weight: 42 }),
      /invalid document .* weight must be <= 1/,
    );
  });

  it('rejects a bad field type before touching Mongo', async () => {
    await assert.rejects(
      () => record({ key: 'data/a.mp4', name: 123 }),
      /invalid document .* name must be a string/,
    );
  });
});

// Integration: set MONGO_URL to run these, e.g.
//   docker run -d --rm -p 27021:27017 mongo:7
//   MONGO_URL=mongodb://localhost:27021/zap-test npm test
const NO_DB = !process.env.MONGO_URL;

describe('record + find round trip (needs MONGO_URL)', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  // The shared client keeps the event loop alive; close it or the runner hangs.
  after(() => MongoConnexion.close());

  it('stores a normalized document and reads it back', async () => {
    const key = `test/roundtrip-${Date.now()}.mp4`;
    await record({ key, source: key, name: 'roundtrip.mp4', type: 'video/mp4', weight: 0.42 });

    const found = await find(key);
    assert.ok(found, 'document should be found');
    assert.equal(found.key, key);
    assert.equal(found.source, key);
    assert.equal(found.weight, 0.42);
  });

  it('fills derivable fields when only source is given', async () => {
    const key = `test/derive-${Date.now()}.jpg`;
    await record({ key, source: key });

    const found = await find(key);
    // Regression: find() used to log data.SourceFile, which explore never wrote.
    // The stored field is `source` — assert the model's field, not the old one.
    assert.equal(found.source, key);
    assert.equal(found.SourceFile, undefined);
    assert.equal(found.name, `derive-${key.split('-')[1]}`);
    assert.equal(found.type, 'image/jpeg');
    assert.ok(found.weight >= 0 && found.weight <= 1);
  });

  it('returns undefined-ish for a key that is not there', async () => {
    assert.equal(await find('test/does-not-exist'), null);
  });

  it('upserts rather than duplicating on a repeat write', async () => {
    const key = `test/upsert-${Date.now()}.mp4`;
    await record({ key, source: key, weight: 0.1 });
    await record({ key, source: key, weight: 0.9 });
    assert.equal((await find(key)).weight, 0.9);
  });
});

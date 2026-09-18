import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import list from '../action/list.js';
import MongoConnexion from '../utils/MongoConnexion.js';

const NO_DB = !process.env.MONGO_URL;

describe('list (needs MONGO_URL)', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  let col;

  before(async () => {
    const db = await MongoConnexion.db();
    col = db.collection('data');
    await col.deleteMany({ key: /^listtest\// });
    const docs = [];
    for (let i = 0; i < 30; i++) {
      docs.push({
        key: `listtest/f${String(i).padStart(2, '0')}.${i % 2 ? 'mp4' : 'jpg'}`,
        source: `listtest/f${i}`,
        name: `listtest-f${String(i).padStart(2, '0')}.${i % 2 ? 'mp4' : 'jpg'}`,
        type: i % 2 ? 'video/mp4' : 'image/jpeg',
        weight: i / 30,
      });
    }
    await col.insertMany(docs);
  });

  after(async () => {
    await col.deleteMany({ key: /^listtest\// });
    await MongoConnexion.close();
  });

  const onlyTest = (params) => list({ ...params, search: 'listtest-' });

  it('returns a page with a total', async () => {
    const page = await onlyTest({ limit: 10 });
    assert.equal(page.items.length, 10);
    assert.equal(page.total, 30);
    assert.equal(page.skip, 0);
  });

  it('paginates without repeating', async () => {
    const a = await onlyTest({ limit: 10, skip: 0 });
    const b = await onlyTest({ limit: 10, skip: 10 });
    const overlap = a.items.filter(x => b.items.some(y => y.key === x.key));
    assert.equal(overlap.length, 0);
  });

  it('reaches the last page', async () => {
    const page = await onlyTest({ limit: 10, skip: 20 });
    assert.equal(page.items.length, 10);
    const past = await onlyTest({ limit: 10, skip: 30 });
    assert.equal(past.items.length, 0, 'past the end returns nothing, not an error');
    assert.equal(past.total, 30, 'total stays correct past the end');
  });

  it('sorts by date, newest and oldest first', async () => {
    const newest = await onlyTest({ limit: 5, sort: 'date', order: -1 });
    const oldest = await onlyTest({ limit: 5, sort: 'date', order: 1 });
    assert.equal(newest.sort, 'date', 'the requested name is echoed back, not the _id it maps to');
    assert.notEqual(newest.items[0].key, oldest.items[0].key, 'the two orders should differ');

    const times = newest.items.map(i => new Date(i.addedAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first should be descending');
  });

  it('gives every item an addedAt, derived from the document id', async () => {
    const page = await onlyTest({ limit: 5 });
    for (const item of page.items) {
      assert.ok(item.addedAt, `${item.key} should carry addedAt`);
      assert.ok(!Number.isNaN(new Date(item.addedAt).getTime()), 'addedAt should parse as a date');
    }
  });

  it('never leaks the mongo id, even though date sorting uses it', async () => {
    const page = await onlyTest({ limit: 5, sort: 'date' });
    for (const item of page.items) assert.equal(item._id, undefined);
  });

  it('sorts by weight in both directions', async () => {
    const desc = await onlyTest({ limit: 5, sort: 'weight', order: -1 });
    const asc = await onlyTest({ limit: 5, sort: 'weight', order: 1 });
    assert.ok(desc.items[0].weight > desc.items[4].weight);
    assert.ok(asc.items[0].weight < asc.items[4].weight);
  });

  it('filters by MIME prefix', async () => {
    const vids = await onlyTest({ limit: 100, type: 'video' });
    assert.equal(vids.total, 15);
    assert.ok(vids.items.every(i => i.type.startsWith('video')));
  });

  it('filters by name substring, case-insensitively', async () => {
    const hit = await list({ search: 'LISTTEST-F0' });
    assert.ok(hit.total >= 10, `expected case-insensitive match, got ${hit.total}`);
  });

  it('never returns file contents', async () => {
    const page = await onlyTest({ limit: 30 });
    for (const item of page.items) {
      assert.equal(item.src, undefined, 'no base64 payload');
      assert.equal(item.source, undefined, 'no disk path');
      assert.equal(item._id, undefined, 'no mongo id');
    }
    // A full page must stay small enough to cross a socket comfortably.
    assert.ok(JSON.stringify(page.items).length < 20_000);
  });

  it('clamps hostile parameters', async () => {
    const page = await onlyTest({ limit: 9999, skip: -10, sort: 'weight; drop table', order: 'evil' });
    assert.equal(page.limit, 200, 'limit capped');
    assert.equal(page.skip, 0, 'negative skip floored');
    assert.equal(page.sort, 'name', 'unknown sort field rejected');
    assert.equal(page.order, 1, 'non-numeric order defaults to ascending');
  });

  it('treats regex metacharacters in search as literal text', async () => {
    await assert.doesNotReject(() => list({ search: '.*(' }));
    const page = await list({ search: '.*(' });
    assert.equal(page.total, 0, 'should match nothing, not everything');
  });

  it('defaults sensibly with no arguments', async () => {
    const page = await list();
    assert.equal(page.limit, 25);
    assert.equal(page.sort, 'name');
    assert.ok(Array.isArray(page.items));
  });
});

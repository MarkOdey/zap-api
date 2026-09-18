import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import MongoConnexion from '../utils/MongoConnexion.js';

const NO_DB = !process.env.MONGO_URL;

describe('remove (needs MONGO_URL)', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  let remove;
  let col;
  let edgeCol;
  let dir;

  before(async () => {
    // DATA_DIR gates which files may be deleted, so it must be set before import.
    dir = path.resolve('removetest-data');
    process.env.DATA_DIR = dir;
    remove = (await import('../action/remove.js')).default;
    const db = await MongoConnexion.db();
    col = db.collection('data');
    edgeCol = db.collection('edges');
  });

  after(async () => {
    await col.deleteMany({ key: /^removetest/ });
    await edgeCol.deleteMany({ key: /^removetest/ });
    await fs.rm(dir, { recursive: true, force: true });
    await MongoConnexion.close();
  });

  beforeEach(async () => {
    await col.deleteMany({ key: /^removetest/ });
    await edgeCol.deleteMany({ key: /^removetest/ });
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  });

  async function make(name, extra = {}) {
    const source = path.join(dir, name);
    await fs.writeFile(source, 'x');
    const doc = { key: `removetest/${name}`, source, name, type: 'image/jpeg', weight: 0.5, ...extra };
    await col.insertOne(doc);
    return doc;
  }

  const exists = async (p) => fs.access(p).then(() => true, () => false);

  it('removes the document, the file and its edges', async () => {
    const a = await make('a.jpg');
    const b = await make('b.jpg');
    await edgeCol.insertMany([
      { key: 'removetest-1', from: a.key, to: b.key, type: 'theme', weight: 0.5 },
      { key: 'removetest-2', from: b.key, to: a.key, type: 'theme', weight: 0.5 },
    ]);

    const report = await remove({ key: a.key });

    assert.equal(await col.countDocuments({ key: a.key }), 0);
    assert.equal(await exists(a.source), false, 'the file should be gone');
    assert.equal(report.edges, 2, 'edges in both directions should go');
    assert.equal(await col.countDocuments({ key: b.key }), 1, 'the other document is untouched');
    assert.equal(await exists(b.source), true);
  });

  it('accepts a bare key as well as an object', async () => {
    const a = await make('bare.jpg');
    await remove(a.key);
    assert.equal(await col.countDocuments({ key: a.key }), 0);
  });

  it('leaves derivatives alone by default', async () => {
    const src = await make('src.jpg');
    const cut = await make('src.cut.webp', { generator: 'isolate', derivedFrom: [src.key] });

    await remove({ key: src.key });

    assert.equal(await col.countDocuments({ key: cut.key }), 1, 'a cutout outlives its source by default');
    assert.equal(await exists(cut.source), true);
  });

  it('removes derivatives at any depth when asked', async () => {
    const src = await make('deep.jpg');
    const cut = await make('deep.cut.webp', { generator: 'isolate', derivedFrom: [src.key] });
    const mix = await make('deep.mix.webp', { generator: 'compose', derivedFrom: [cut.key] });

    const report = await remove({ key: src.key, cascade: true });

    assert.equal(report.removed.length, 3, 'source, cutout and the thing made from the cutout');
    for (const d of [src, cut, mix]) {
      assert.equal(await col.countDocuments({ key: d.key }), 0);
      assert.equal(await exists(d.source), false);
    }
  });

  it('rejects a missing key clearly', async () => {
    await assert.rejects(() => remove({ key: 'removetest/nope' }), /no document for key/);
  });

  it('rejects a key that is not a usable string', async () => {
    for (const bad of [undefined, null, '', '   ', true, 42]) {
      await assert.rejects(() => remove({ key: bad }), /key must be a non-empty string/);
    }
  });

  it('still clears the document when the file has already gone', async () => {
    const a = await make('ghost.jpg');
    await fs.unlink(a.source);
    const report = await remove({ key: a.key });
    assert.equal(report.files, 0, 'no file was deleted');
    assert.equal(await col.countDocuments({ key: a.key }), 0, 'but the record is cleared');
  });

  // A poisoned record must not turn deletion into arbitrary file removal.
  it('refuses to delete a file outside DATA_DIR', async () => {
    const outside = path.resolve('removetest-outside.txt');
    await fs.writeFile(outside, 'precious');
    await col.insertOne({
      key: 'removetest/escape', source: outside, name: 'escape', type: 'text/plain', weight: 0.5,
    });

    const report = await remove({ key: 'removetest/escape' });

    assert.equal(report.files, 0, 'nothing outside the media directory may be deleted');
    assert.equal(await exists(outside), true, 'the file must survive');
    assert.equal(await col.countDocuments({ key: 'removetest/escape' }), 0, 'the record still goes');
    await fs.rm(outside, { force: true });
  });
});

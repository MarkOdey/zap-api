import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

import { parseRange, mediaUrl, mountMedia } from '../utils/mediaRoute.js';
import MongoConnexion from '../utils/MongoConnexion.js';

// Each test file runs in its own process and shares one MongoDB server, so they
// would otherwise collide: a file that counts documents sees another file's
// fixtures. MONGO_DB overrides the database taken from MONGO_URL, giving this
// file a database of its own.
process.env.MONGO_DB = 'zap-test-mediaRoute';


describe('parseRange', () => {
  const SIZE = 1000;

  it('returns null when there is no range header', () => {
    assert.equal(parseRange(undefined, SIZE), null);
    assert.equal(parseRange('', SIZE), null);
  });

  it('parses a closed range', () => {
    assert.deepEqual(parseRange('bytes=0-99', SIZE), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=100-199', SIZE), { start: 100, end: 199 });
  });

  it('parses an open-ended range', () => {
    assert.deepEqual(parseRange('bytes=900-', SIZE), { start: 900, end: 999 });
  });

  it('parses a suffix range', () => {
    assert.deepEqual(parseRange('bytes=-100', SIZE), { start: 900, end: 999 });
  });

  it('clamps an end beyond the file to the last byte', () => {
    assert.deepEqual(parseRange('bytes=0-99999', SIZE), { start: 0, end: 999 });
  });

  it('clamps a suffix larger than the file to the whole file', () => {
    assert.deepEqual(parseRange('bytes=-99999', SIZE), { start: 0, end: 999 });
  });

  it('rejects ranges that cannot be satisfied', () => {
    assert.equal(parseRange('bytes=1000-', SIZE), 'invalid', 'start at EOF');
    assert.equal(parseRange('bytes=5000-6000', SIZE), 'invalid', 'wholly past EOF');
    assert.equal(parseRange('bytes=200-100', SIZE), 'invalid', 'inverted');
    assert.equal(parseRange('bytes=-0', SIZE), 'invalid', 'empty suffix');
  });

  it('rejects malformed headers rather than guessing', () => {
    for (const bad of ['bytes=abc', 'bytes=', 'items=0-10', 'bytes=0-10, 20-30', 'garbage']) {
      assert.equal(parseRange(bad, SIZE), 'invalid', `${bad} should be invalid`);
    }
  });

  it('handles a one-byte file', () => {
    assert.deepEqual(parseRange('bytes=0-0', 1), { start: 0, end: 0 });
    assert.equal(parseRange('bytes=1-', 1), 'invalid');
  });
});

describe('mediaUrl', () => {
  it('encodes the key so slashes survive as a single path segment', () => {
    assert.equal(mediaUrl('data/a.jpg'), '/media/data%2Fa.jpg');
  });

  it('encodes characters that would otherwise break the URL', () => {
    assert.equal(mediaUrl('data/giphy (2).gif'), '/media/data%2Fgiphy%20(2).gif');
    assert.ok(!mediaUrl('data/a b&c?d.jpg').includes('?'));
    assert.ok(!mediaUrl('data/a b&c?d.jpg').includes('&'));
  });
});

const NO_DB = !process.env.MONGO_URL;

describe('media route (needs MONGO_URL)', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  let server;
  let base;
  let col;
  let dir;
  const BODY = Buffer.from('0123456789'.repeat(100)); // 1000 bytes

  before(async () => {
    dir = await fs.mkdtemp(path.join(process.cwd(), 'mediatest-'));
    process.env.DATA_DIR = dir;
    await fs.writeFile(path.join(dir, 'clip.bin'), BODY);

    const db = await MongoConnexion.db();
    col = db.collection('data');
    await col.deleteMany({ key: /^mediatest\// });
    await col.insertMany([
      { key: 'mediatest/clip', source: path.join(dir, 'clip.bin'), name: 'clip.bin', type: 'video/mp4', weight: 0.5 },
      { key: 'mediatest/missing', source: path.join(dir, 'gone.bin'), name: 'gone.bin', type: 'video/mp4', weight: 0.5 },
      { key: 'mediatest/escape', source: '/etc/passwd', name: 'passwd', type: 'text/plain', weight: 0.5 },
    ]);

    const app = express();
    mountMedia(app);
    server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    base = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await col.deleteMany({ key: /^mediatest\// });
    await MongoConnexion.close();
    await new Promise(r => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });

  const get = (p, headers) => fetch(`${base}${p}`, { headers });

  it('serves a whole file with the stored MIME type', async () => {
    const res = await get(mediaUrl('mediatest/clip'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(Buffer.from(await res.arrayBuffer()).length, BODY.length);
  });

  it('serves the exact bytes', async () => {
    const res = await get(mediaUrl('mediatest/clip'));
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(BODY));
  });

  it('answers a range request with 206 and the right slice', async () => {
    const res = await get(mediaUrl('mediatest/clip'), { Range: 'bytes=10-19' });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 10-19/1000');
    assert.equal(await res.text(), BODY.subarray(10, 20).toString());
  });

  it('reassembles correctly from consecutive ranges', async () => {
    const a = await (await get(mediaUrl('mediatest/clip'), { Range: 'bytes=0-499' })).arrayBuffer();
    const b = await (await get(mediaUrl('mediatest/clip'), { Range: 'bytes=500-' })).arrayBuffer();
    assert.ok(Buffer.concat([Buffer.from(a), Buffer.from(b)]).equals(BODY));
  });

  it('returns 416 for an unsatisfiable range', async () => {
    const res = await get(mediaUrl('mediatest/clip'), { Range: 'bytes=99999-' });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */1000');
  });

  it('revalidates with ETag', async () => {
    const first = await get(mediaUrl('mediatest/clip'));
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const second = await get(mediaUrl('mediatest/clip'), { 'If-None-Match': etag });
    assert.equal(second.status, 304);
  });

  it('404s for a key that is not in the library', async () => {
    assert.equal((await get(mediaUrl('mediatest/nope'))).status, 404);
  });

  it('404s when the document exists but the file does not', async () => {
    assert.equal((await get(mediaUrl('mediatest/missing'))).status, 404);
  });

  // The path never comes from the URL, but a poisoned record must not escape either.
  it('refuses to serve a document pointing outside DATA_DIR', async () => {
    const res = await get(mediaUrl('mediatest/escape'));
    assert.equal(res.status, 403, 'must not serve /etc/passwd');
  });

  it('never serves arbitrary paths passed as the key', async () => {
    for (const k of ['../../etc/passwd', '/etc/passwd', 'package.json', '../package.json']) {
      const res = await get(mediaUrl(k));
      assert.ok(res.status === 404 || res.status === 403, `${k} returned ${res.status}`);
    }
  });
});

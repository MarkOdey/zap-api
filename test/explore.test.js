import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Own database, like the other DB-touching suites, so fixtures never collide.
process.env.MONGO_DB = 'zap-test-explore';

import explore, { videoMetadata } from '../action/explore.js';
import find from '../action/find.js';
import MongoConnexion from '../utils/MongoConnexion.js';

const META = { hasAudio: true, duration: 12, width: 1920, height: 1080 };
const stubDescribe = async () => ({ ...META });

describe('explore: videoMetadata (lazy probe decision, no DB)', () => {
  it('probes when the document has never been probed', async () => {
    const meta = await videoMetadata(null, 'a.mp4', { mtimeMs: 100 }, stubDescribe);
    assert.deepEqual(meta, { ...META, mtimeMs: 100 });
  });

  it('probes when hasAudio is missing even if a document exists', async () => {
    const meta = await videoMetadata({ mtimeMs: 100 }, 'a.mp4', { mtimeMs: 100 }, stubDescribe);
    assert.deepEqual(meta, { ...META, mtimeMs: 100 });
  });

  it('re-probes when the file mtime has changed', async () => {
    const existing = { hasAudio: false, mtimeMs: 100 };
    const meta = await videoMetadata(existing, 'a.mp4', { mtimeMs: 200 }, stubDescribe);
    assert.deepEqual(meta, { ...META, mtimeMs: 200 });
  });

  it('skips probing when already known and unchanged', async () => {
    const existing = { hasAudio: true, mtimeMs: 100 };
    const meta = await videoMetadata(existing, 'a.mp4', { mtimeMs: 100 }, stubDescribe);
    assert.equal(meta, null);
  });

  it('swallows a probe failure and indexes without metadata', async () => {
    const boom = async () => { throw new Error('no ffprobe'); };
    const meta = await videoMetadata(null, 'a.mp4', { mtimeMs: 100 }, boom);
    assert.equal(meta, null);
  });
});

const NO_DB = !process.env.MONGO_URL;

describe('explore: records video metadata', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  after(() => MongoConnexion.close());

  it('probes a video and stores hasAudio on the document', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zap-explore-'));
    const prev = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;

    try {
      const file = path.join(dir, 'clip.mp4');
      await fs.writeFile(file, 'not really a video, but explore only stats + probes it');

      const db = await MongoConnexion.db();
      await db.collection('data').deleteMany({ key: file });

      await explore({ describe: stubDescribe });

      const doc = await find(file);
      assert.ok(doc, 'the video should have been indexed');
      assert.equal(doc.hasAudio, true);
      assert.equal(doc.width, 1920);
      assert.equal(typeof doc.mtimeMs, 'number');

      await db.collection('data').deleteMany({ key: file });
    } finally {
      if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.MONGO_DB = 'zap-test-respond';

import { rankItemsByTerms } from '../action/ingest.js';
import respond from '../action/respond.js';
import { normalize as normalizeMission } from '../model/mission.js';
import MongoConnexion from '../utils/MongoConnexion.js';

describe('ingest: rankItemsByTerms (term-biased fetch)', () => {
  const items = [
    { title: 'A quiet morning', summary: 'nothing here' },
    { title: 'Pumpkin patch', summary: 'autumn and spooky fun' },
    { title: 'Tech news', summary: 'a spooky bug' },
  ];

  it('brings term-matching items to the front, most matches first', () => {
    const ranked = rankItemsByTerms(items, ['spooky', 'pumpkin']);
    assert.equal(ranked[0].title, 'Pumpkin patch'); // matches both
    assert.equal(ranked[1].title, 'Tech news');     // matches one
    assert.equal(ranked[2].title, 'A quiet morning'); // matches none
  });

  it('keeps original order among ties', () => {
    const ranked = rankItemsByTerms(items, ['nomatch']);
    assert.deepEqual(ranked.map(i => i.title), items.map(i => i.title));
  });
});

const NO_DB = !process.env.MONGO_URL;

describe('respond: answering a mission', { skip: NO_DB && 'MONGO_URL not set' }, () => {
  after(() => MongoConnexion.close());

  it('ingests a text answer, pre-tags it, links it, and closes the mission', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zap-respond-'));
    const prev = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;

    try {
      const db = await MongoConnexion.db();
      const missions = db.collection('missions');
      const data = db.collection('data');

      // A neighbour already tagged 'bicycle', so the answer should link to it.
      await data.deleteMany({});
      await data.insertOne({ key: 'x/neighbour.jpg', source: 'x/neighbour.jpg', name: 'neighbour.jpg', type: 'image/jpeg', weight: 0.5, labels: ['bicycle'] });

      const mission = normalizeMission({ prompt: 'Tell me about bicycles.', kind: 'answer', accepts: ['text'], terms: ['bicycle'] });
      await missions.deleteMany({});
      await missions.insertOne(mission);

      const res = await respond({ missionKey: mission.key, text: 'I love my old bicycle.' });

      const answer = await data.findOne({ key: res.key });
      assert.ok(answer, 'answer document was created');
      assert.deepEqual(answer.labels, ['bicycle'], 'pre-tagged with mission terms');
      assert.equal(answer.origin, 'mission');

      const closed = await missions.findOne({ key: mission.key });
      assert.equal(closed.status, 'answered');
      assert.ok(closed.responses.includes(res.key));

      const edge = await db.collection('edges').findOne({ from: res.key, to: 'x/neighbour.jpg' });
      assert.ok(edge, 'answer linked to the neighbour sharing the term');

      await data.deleteMany({});
      await missions.deleteMany({});
      await db.collection('edges').deleteMany({ from: res.key });
    } finally {
      if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import MongoConnexion from '../utils/MongoConnexion.js';
import record from './record.js';
import connect from './connect.js';
import queue from '../utils/queue.js';
import { normalizeTerms } from '../model/mission.js';
import { mediaKind } from '../model/document.js';
import { SUBJECT } from '../relation/statement.js';

/**
 * Answer a mission.
 *
 * The answer becomes a library document pre-tagged with the mission's terms, so it
 * enters the graph already lexically related and its terms seed the media-finding
 * loop. Text answers are written to a file like RSS ingest; image/video answers
 * are uploaded first (via the existing `upload` action) and referenced by `key`.
 *
 * @param {object} params
 * @param {string} params.missionKey
 * @param {string} [params.text]  a text answer
 * @param {string} [params.key]   the key of an already-uploaded image/video answer
 */
async function respond(params = {}) {
  const { missionKey, text, key } = params;
  if (!missionKey) throw new Error('respond: missionKey is required');
  if (!text && !key) throw new Error('respond: an answer (text or key) is required');

  const db = await MongoConnexion.db();
  const col = db.collection('data');
  const missions = db.collection('missions');

  const mission = await missions.findOne({ key: missionKey });
  if (!mission) throw new Error(`respond: no mission ${missionKey}`);

  const terms = normalizeTerms(mission.terms);
  let answerKey = key;

  if (text) {
    answerKey = await writeText(text);
    await record({
      key: answerKey, source: answerKey, name: path.basename(answerKey),
      type: 'text/plain', origin: 'mission',
    });
  } else {
    const exists = await col.findOne({ key: answerKey });
    if (!exists) throw new Error(`respond: no uploaded document ${answerKey}`);
  }

  // Pre-tag with the mission's terms so the answer is linkable immediately, before
  // any analysis runs. `analyse` will confirm/augment image and video answers.
  await col.updateOne(
    { key: answerKey },
    { $set: {
      origin: 'mission',
      missionKey,
      labels: terms,
      subjects: terms.map(label => ({ label, coverage: 0.5, count: 1, score: 1 })),
    } },
  );

  const doc = await col.findOne({ key: answerKey });
  if (['image', 'video'].includes(mediaKind(doc))) {
    queue.push('analyse', { key: answerKey });
  }

  await linkByTerms(col, answerKey, terms);

  await missions.updateOne(
    { key: missionKey },
    { $set: { status: 'answered', answeredAt: new Date() }, $addToSet: { responses: answerKey } },
  );

  console.log(`respond: ${missionKey} answered by ${answerKey}`);
  return { missionKey, key: answerKey, terms };
}

/** Write a text answer to DATA_DIR, keyed by a hash so it is stable and unique. */
async function writeText(text) {
  const dataDir = process.env.DATA_DIR || './data';
  const id = crypto.createHash('sha1').update(text + Date.now()).digest('hex').slice(0, 12);
  const key = path.join(dataDir, `mission-${id}.txt`);
  await fs.writeFile(key, String(text).trim(), 'utf8');
  return key;
}

/** Edge the answer to existing documents that share each term. */
async function linkByTerms(col, from, terms) {
  for (const term of terms) {
    const others = await col
      .find({ key: { $ne: from }, labels: term }, { projection: { key: 1 } })
      .limit(3)
      .toArray();
    for (const other of others) {
      await connect({ from, to: other.key, type: SUBJECT, weight: 0.5 }).catch(() => {});
    }
  }
}

export default respond;

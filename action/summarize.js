import fs from 'fs/promises';

import MongoConnexion from '../utils/MongoConnexion.js';
import find from './find.js';
import { summarise } from '../utils/summary.js';

/**
 * Condense a text document in place.
 *
 * Feed items arrive padded — Hacker News items carry "Article URL … Comments URL
 * … Points: 165 # Comments: 46" — and the text player renders whatever it is given
 * very large, so the padding crowds out the headline.
 *
 * The original is kept on the document as `summarizedFrom`, so nothing is lost and
 * the change can be inspected or undone.
 *
 * @param {object|string} params
 * @param {string}        params.key
 */
async function summarize(params) {
  const key = typeof params === 'string' ? params : params?.key;
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('summarize: key must be a text document key');
  }

  const doc = await find(key);
  if (!doc) throw new Error(`summarize: no document for key ${key}`);
  if (!doc.type?.includes('text')) {
    throw new Error(`summarize: ${key} is ${doc.type || 'untyped'}, expected text`);
  }
  if (doc.summarizedFrom) {
    console.log('summarize: already done for', key);
    return { key, skipped: 'already summarized' };
  }

  const original = await fs.readFile(doc.source, 'utf8');
  const summary = await summarise(original);

  if (!summary) {
    console.log('summarize: nothing to condense in', key);
    // Record the attempt, or it will be retried on every pass.
    await mark(key, original);
    return { key, skipped: 'already concise' };
  }

  await fs.writeFile(doc.source, summary, 'utf8');
  await mark(key, original);

  console.log(`summarize: ${key} — ${original.trim().length} chars to ${summary.length}`);
  return { key, from: original.trim().length, to: summary.length, summary };
}

async function mark(key, original) {
  const db = await MongoConnexion.db();
  await db.collection('data').updateOne(
    { key },
    { $set: { summarizedFrom: String(original).replace(/\s+/g, ' ').trim().slice(0, 2000) } },
  );
}

export default summarize;

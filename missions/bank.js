import crypto from 'node:crypto';

import MongoConnexion from '../utils/MongoConnexion.js';
import { normalize as normalizeMission } from '../model/mission.js';

/**
 * The runtime-editable prompt bank.
 *
 * A `prompts` collection the user maintains from the client. It is both the
 * fallback generator (when Ollama is down) and a way to pin your own broad prompts
 * and steer the LLM. Seeded with a starter set on first run.
 */

/** Starter prompts — broad and open-ended, like the ones the request described. */
export const STARTER = [
  { text: 'Get a picture of a dog.', accepts: ['image'], terms: ['dog'] },
  { text: 'Film yourself falling down.', accepts: ['video'], terms: ['fall'] },
  { text: 'Tell me a quote of the day.', accepts: ['text'], terms: ['quote'] },
  { text: 'Show me the sky right now.', accepts: ['image', 'video'], terms: ['sky'] },
  { text: 'Capture something red.', accepts: ['image', 'video'], terms: ['red'] },
  { text: 'Describe a memory from childhood.', accepts: ['text'], terms: ['memory', 'childhood'] },
  { text: 'Find the oldest thing near you.', accepts: ['image', 'video'], terms: ['old'] },
  { text: 'Record a sound you love.', accepts: ['video'], terms: ['sound'] },
];

const idOf = (text) => `prompt-${crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12)}`;

async function col() {
  return (await MongoConnexion.db()).collection('prompts');
}

/** Insert the starter set once (idempotent by id). */
export async function seed() {
  const c = await col();
  let added = 0;
  for (const p of STARTER) {
    const id = idOf(p.text);
    const res = await c.updateOne(
      { id },
      { $setOnInsert: { id, ...p, enabled: true, createdAt: new Date(), lastUsedAt: null } },
      { upsert: true },
    );
    if (res.upsertedCount) added++;
  }
  return { added, total: await c.countDocuments() };
}

export async function list() {
  return (await col()).find({}, { projection: { _id: 0 } }).toArray();
}

export async function add({ text, accepts, terms }) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('prompt: text required');
  const id = idOf(text);
  const doc = {
    id, text: text.trim(),
    accepts: Array.isArray(accepts) && accepts.length ? accepts : ['image', 'video', 'text'],
    terms: Array.isArray(terms) ? terms : [],
    enabled: true, createdAt: new Date(), lastUsedAt: null,
  };
  await (await col()).updateOne({ id }, { $set: doc }, { upsert: true });
  return doc;
}

export async function update(id, fields = {}) {
  const allowed = {};
  for (const k of ['text', 'accepts', 'terms', 'enabled']) if (k in fields) allowed[k] = fields[k];
  await (await col()).updateOne({ id }, { $set: allowed });
  return { id, ...allowed };
}

export async function remove(id) {
  const { deletedCount } = await (await col()).deleteOne({ id });
  return { removed: deletedCount };
}

/**
 * Fallback generator: pick the least-recently-used enabled prompt and build a
 * mission from it. Seeds the bank if it is empty.
 */
export async function generateMission() {
  const c = await col();
  if (await c.countDocuments() === 0) await seed();

  const [p] = await c
    .find({ enabled: { $ne: false } })
    .sort({ lastUsedAt: 1 })
    .limit(1)
    .toArray();

  if (!p) return null;

  await c.updateOne({ id: p.id }, { $set: { lastUsedAt: new Date() } });
  return normalizeMission({
    prompt: p.text,
    accepts: p.accepts,
    terms: p.terms,
    kind: p.accepts?.length === 1 && p.accepts[0] === 'text' ? 'answer' : 'find',
    origin: 'bank',
    source: p.id,
  });
}

export default { STARTER, seed, list, add, update, remove, generateMission };

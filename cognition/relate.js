import MongoConnexion from '../utils/MongoConnexion.js';
import connect from '../action/connect.js';
import TYPES, { SUBJECT } from '../relation/statement.js';

const typeValues = Object.values(TYPES);

/** How much of a shared subject is needed before two documents are linked. */
const MIN_COVERAGE = Number(process.env.RELATE_MIN_COVERAGE || 0.05);

/**
 * Draw edges between documents.
 *
 * Prefers a shared subject: two photographs that both contain a bicycle are
 * related in a way two random documents are not. Playback walks these edges, so a
 * graph built on what things actually contain makes the sequence follow a thread
 * rather than wander.
 *
 * Falls back to the original random pairing when nothing has been analysed yet, so
 * a library with no labels still accumulates a graph.
 */
export default async function relateTask() {
  const db = await MongoConnexion.db();
  const col = db.collection('data');

  if (await linkBySubject(col)) return;
  await linkAtRandom(col);
}

/**
 * Pick a subject, then two documents that share it.
 *
 * Weight follows how much of each frame the subject occupies: a photograph that is
 * mostly bicycle is more about bicycles than one with a bicycle in the corner.
 */
async function linkBySubject(col) {
  const [candidate] = await col.aggregate([
    { $match: { labels: { $exists: true, $ne: [] } } },
    { $sample: { size: 1 } },
    { $project: { key: 1, subjects: 1 } },
  ]).toArray();

  if (!candidate?.subjects?.length) return false;

  const subject = candidate.subjects.find(s => s.coverage >= MIN_COVERAGE);
  if (!subject) return false;

  const [other] = await col.aggregate([
    {
      $match: {
        key: { $ne: candidate.key },
        labels: subject.label,
      },
    },
    { $sample: { size: 1 } },
    { $project: { key: 1, subjects: 1 } },
  ]).toArray();

  if (!other) return false;

  const theirs = other.subjects?.find(s => s.label === subject.label)?.coverage ?? 0;
  // Both ends matter: a link is only as strong as the weaker association.
  const weight = Math.min(1, Math.max(0.2, Math.min(subject.coverage, theirs) * 2));

  await connect({ from: candidate.key, to: other.key, type: SUBJECT, weight });
  console.log(`relate: ${subject.label} links ${candidate.key.split('/').pop()} and ${other.key.split('/').pop()} (${weight.toFixed(2)})`);
  return true;
}

/** The original behaviour: two documents at random, an arbitrary relation. */
async function linkAtRandom(col) {
  const items = await col.aggregate([{ $sample: { size: 2 } }]).toArray();
  if (items.length < 2) return;

  const [a, b] = items;
  const type = typeValues[Math.floor(Math.random() * typeValues.length)];
  await connect({ from: a.key, to: b.key, type, weight: 0.5 });
}

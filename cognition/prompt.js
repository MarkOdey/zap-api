import MongoConnexion from '../utils/MongoConnexion.js';
import { generateMission } from '../missions/generator.js';
import { build as buildVocab, steeringTerms } from '../utils/vocabulary.js';
import { getCurrentTheme } from '../missions/themeStore.js';
import { validate } from '../model/mission.js';

/** Keep a small pool of open missions; generate one per tick until it is full. */
const MAX_OPEN = Number(process.env.MISSION_MAX_OPEN || 3);

export default async function promptTask() {
  const db = await MongoConnexion.db();
  const col = db.collection('missions');

  if (await col.countDocuments({ status: 'open' }) >= MAX_OPEN) return;

  const vocab = await buildVocab().catch(() => []);
  const recent = await col.find({}, { projection: { prompt: 1 } })
    .sort({ createdAt: -1 }).limit(8).toArray();
  const theme = await getCurrentTheme().catch(() => null);

  const context = {
    terms: steeringTerms(vocab),
    history: recent.map(r => r.prompt),
    theme: theme ? { label: theme.label, terms: theme.terms } : null,
  };

  const mission = await generateMission(context);
  const { valid, errors } = validate(mission);
  if (!valid) {
    console.warn('prompt: generated mission invalid —', errors.join('; '));
    return;
  }

  // Don't stack an identical open prompt.
  if (await col.countDocuments({ prompt: mission.prompt, status: 'open' })) return;

  await col.insertOne(mission);
  console.log('prompt: new mission —', mission.prompt);
  return mission;
}

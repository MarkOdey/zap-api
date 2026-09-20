import MongoConnexion from '../utils/MongoConnexion.js';
import { computeCalendar } from '../utils/calendar.js';
import { pickDomain, DEFAULT_DOMAINS, DEFAULT_SCHEDULE } from './domains.js';
import { generateTheme } from './generator.js';
import * as recurrence from '../utils/recurrence.js';
import { normalize as normalizeTheme } from '../model/theme.js';

/**
 * Storage and assembly for the hourly theme: the runtime-editable domain/schedule
 * config, the current theme, and the generate-and-store step the cognition task
 * runs.
 */

async function cfgCol() { return (await MongoConnexion.db()).collection('config'); }
async function themeCol() { return (await MongoConnexion.db()).collection('themes'); }

/** The domain palette + hour→domain schedule (defaults unless overridden). */
export async function getConfig() {
  const doc = await (await cfgCol()).findOne({ key: 'theme' });
  return {
    domains: doc?.domains ?? DEFAULT_DOMAINS,
    schedule: doc?.schedule ?? DEFAULT_SCHEDULE,
  };
}

export async function setConfig({ domains, schedule } = {}) {
  const set = { key: 'theme' };
  if (Array.isArray(domains)) set.domains = domains;
  if (schedule && typeof schedule === 'object') set.schedule = schedule;
  await (await cfgCol()).updateOne({ key: 'theme' }, { $set: set }, { upsert: true });
  return getConfig();
}

/** The latest un-expired theme, or null at cold start. */
export async function getCurrentTheme() {
  const [t] = await (await themeCol())
    .find({ expiresAt: { $gt: new Date() } }, { projection: { _id: 0 } })
    .sort({ generatedAt: -1 })
    .limit(1)
    .toArray();
  return t ?? null;
}

/** Assemble context (recurrence → domain → calendar), generate, and store. */
export async function generateAndStore({ now = new Date(), deps = {} } = {}) {
  const calendar = computeCalendar(now);
  const { domains, schedule } = await getConfig();
  const domain = pickDomain(calendar, { domains, schedule });
  const recur = await recurrence.build({ now }).catch(() => []);

  const theme = await generateTheme({ calendar, domain, recurrence: recur }, deps);
  const stored = normalizeTheme({ ...theme, domain: theme.domain ?? domain });
  await (await themeCol()).insertOne({ ...stored });
  console.log(`theme: ${stored.label} [${stored.domain}] — ${stored.terms.slice(0, 6).join(', ')}`);
  return stored;
}

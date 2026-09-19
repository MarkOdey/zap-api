import * as ollama from './ollama.js';
import * as bank from './bank.js';
import * as template from './template.js';
import { normalize as normalizeTheme } from '../model/theme.js';

/**
 * The mission generator, as a fallback chain: ollama → bank → template. The
 * primary agent is the local LLM; if it is unreachable or off-format the bank
 * stands in, and a template is the last resort so missions never stop.
 *
 * `MISSION_GENERATOR` narrows the chain: 'bank' skips Ollama, 'template' uses only
 * the template. Default 'ollama' runs the whole chain.
 */
export const MISSION_GENERATOR = process.env.MISSION_GENERATOR || 'ollama';

export async function generateMission(context = {}, deps = {}) {
  const chain = missionChain(MISSION_GENERATOR, deps);
  for (const step of chain) {
    try {
      const m = await step(context);
      if (m) return m;
    } catch (err) {
      console.warn(`mission: ${err.message} — falling back`);
    }
  }
  // The template never returns null, but guard anyway.
  return template.generateMission(context);
}

function missionChain(name, deps) {
  const ollamaStep = (c) => ollama.generateMission(c, deps);
  const bankStep = () => bank.generateMission();
  const templateStep = (c) => template.generateMission(c);

  if (name === 'template') return [templateStep];
  if (name === 'bank') return [bankStep, templateStep];
  return [ollamaStep, bankStep, templateStep];
}

/** ollama → calendar/domain fallback, so a theme always exists. */
export async function generateTheme(context = {}, deps = {}) {
  if (MISSION_GENERATOR !== 'template') {
    try {
      return await ollama.generateTheme(context, deps);
    } catch (err) {
      console.warn(`theme: ${err.message} — using calendar fallback`);
    }
  }
  return fallbackTheme(context);
}

/** A grounded theme from domain + calendar + recurrence, without the LLM. */
export function fallbackTheme({ calendar, domain, recurrence = [] } = {}) {
  const holiday = calendar?.nearbyHolidays?.[0];
  const label = holiday?.name || capitalize(domain) || capitalize(calendar?.season) || 'Today';
  const seed = SEED[domain] || SEED[calendar?.season] || SEED.default;
  const terms = [...new Set([...(recurrence || []), ...seed])].slice(0, 12);
  return normalizeTheme({ label, domain: domain ?? null, terms: terms.length ? terms : SEED.default });
}

const SEED = {
  seasonal: ['season', 'light', 'weather', 'sky'],
  spring: ['bloom', 'green', 'rain', 'fresh', 'bird'],
  summer: ['sun', 'heat', 'beach', 'bright', 'water'],
  autumn: ['leaves', 'amber', 'fog', 'harvest', 'cool'],
  winter: ['snow', 'cold', 'quiet', 'frost', 'dark'],
  history: ['past', 'ruin', 'memory', 'old', 'era'],
  philosophy: ['mind', 'meaning', 'time', 'truth', 'doubt'],
  art: ['colour', 'form', 'line', 'light', 'texture'],
  science: ['light', 'motion', 'pattern', 'sky', 'life'],
  nature: ['tree', 'water', 'stone', 'animal', 'sky'],
  music: ['rhythm', 'sound', 'song', 'note', 'voice'],
  literature: ['word', 'story', 'page', 'quiet', 'dream'],
  culture: ['street', 'food', 'crowd', 'ritual', 'colour'],
  love: ['warmth', 'together', 'longing', 'heart', 'hand'],
  religion: ['light', 'silence', 'ritual', 'sky', 'stone'],
  controversial: ['question', 'choice', 'society', 'future', 'truth'],
  default: ['light', 'colour', 'time', 'shape'],
};

function capitalize(s) {
  return typeof s === 'string' && s ? s[0].toUpperCase() + s.slice(1) : null;
}

export { SEED };

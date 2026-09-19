import { generate as ollamaGenerate, parseJsonObject, OLLAMA_MODEL } from '../utils/ollama.js';
import { normalize as normalizeMission, validate as validateMission } from '../model/mission.js';
import { normalize as normalizeTheme, validate as validateTheme } from '../model/theme.js';
import { describeCalendar } from '../utils/calendar.js';

/**
 * The local LLM agent (Ollama). Authors broad, open-ended missions and themed
 * lexicons. Everything runs on-device; nothing leaves the machine.
 */

/** A coarse guard so a wandering model never sets an unsafe or un-answerable task. */
const DENY = /\b(kill|suicide|self-harm|weapon|bomb|explosive|nude|nudity|sexual|porn|drugs?|overdose|hack|password|credit\s?card|social security|home address)\b/i;

const MISSION_SYSTEM =
  'You invent ONE short, playful, safe, open-ended mission for a personal media ' +
  'player — the kind a friend might set: "Get a picture of a dog", "Film yourself ' +
  'falling down", "Tell me a quote of the day", "Who died recently?". It must be ' +
  'answerable by an ordinary person with a phone (no travel, purchases, or anything ' +
  'unsafe or private). Reply with STRICT JSON only: ' +
  '{"prompt": string, "kind": "find"|"create"|"answer", "accepts": array of ' +
  '"image"|"video"|"text", "terms": array of 1-4 lowercase keywords the answer is about}.';

const THEME_SYSTEM =
  'You name a single evocative theme for the moment and list vivid single words for ' +
  'it. Reply with STRICT JSON only: {"label": string, "terms": array of 8-15 ' +
  'lowercase single words}. Keep it tasteful and reflective.';

function missionUserPrompt({ terms = [], history = [], theme = null } = {}) {
  const lines = ['Invent one mission.'];
  if (theme?.label) lines.push(`Lean toward the current theme: ${theme.label} (${(theme.terms ?? []).join(', ')}).`);
  if (terms.length) lines.push(`The library is thin on: ${terms.join(', ')} — a mission about one of these is welcome, but you may ask something entirely new.`);
  if (history.length) lines.push(`Do NOT repeat these recent missions: ${history.map(h => `"${h}"`).join('; ')}.`);
  return lines.join('\n');
}

function themeUserPrompt({ calendar, domain, recurrence = [] } = {}) {
  const lines = [];
  if (calendar) lines.push(describeCalendar(calendar));
  if (domain) lines.push(`Theme domain for this hour: ${domain}.`);
  if (recurrence.length) lines.push(`At times like this, these have come up before: ${recurrence.join(', ')} — you may build on them.`);
  lines.push('Give the theme and its lexicon.');
  return lines.join('\n');
}

/** @throws if the model is unreachable, off-format, or the content is denied. */
export async function generateMission(context = {}, { generate = ollamaGenerate } = {}) {
  const raw = await generate(missionUserPrompt(context), { system: MISSION_SYSTEM, format: 'json' });
  const obj = parseJsonObject(raw);
  if (!obj || typeof obj.prompt !== 'string') throw new Error('ollama: unparseable mission');
  if (DENY.test(obj.prompt)) throw new Error('ollama: mission failed the safety check');

  const mission = normalizeMission({ ...obj, origin: 'ollama', source: OLLAMA_MODEL });
  const { valid, errors } = validateMission(mission);
  if (!valid) throw new Error(`ollama: invalid mission — ${errors.join('; ')}`);
  return mission;
}

/** @throws if the model is unreachable or off-format. */
export async function generateTheme(context = {}, { generate = ollamaGenerate } = {}) {
  const raw = await generate(themeUserPrompt(context), { system: THEME_SYSTEM, format: 'json' });
  const obj = parseJsonObject(raw);
  if (!obj || typeof obj.label !== 'string') throw new Error('ollama: unparseable theme');
  if (DENY.test(obj.label) || (obj.terms ?? []).some(t => DENY.test(String(t)))) {
    throw new Error('ollama: theme failed the safety check');
  }

  const theme = normalizeTheme({ label: obj.label, terms: obj.terms, domain: context.domain ?? null });
  const { valid, errors } = validateTheme(theme);
  if (!valid) throw new Error(`ollama: invalid theme — ${errors.join('; ')}`);
  return theme;
}

export { missionUserPrompt, themeUserPrompt, DENY };

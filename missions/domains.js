/**
 * Theme domains and the hour→domain schedule.
 *
 * The domain says what *kind* of theme suits the moment; the LLM then invents a
 * specific theme and lexicon within it. Both the palette and the schedule are
 * runtime-editable (stored in a `config` collection, edited from the client) —
 * these are only the defaults.
 */

/** The default palette. Sensitive domains are framed for reflection, not harm. */
export const DEFAULT_DOMAINS = [
  'history', 'philosophy', 'art', 'science', 'nature', 'music', 'literature',
  'culture', 'love', 'religion', 'controversial', 'seasonal',
];

/**
 * Default weighted schedule by time-of-day band. Lighter/brighter domains in the
 * day; reflective ones (philosophy, love, literature) in the evening; the two
 * sensitive domains (religion, controversial) only late at night.
 */
export const DEFAULT_SCHEDULE = {
  morning:   { nature: 3, science: 2, seasonal: 2, music: 1, art: 1 },
  afternoon: { art: 3, history: 2, culture: 2, science: 1, seasonal: 1 },
  evening:   { philosophy: 3, literature: 2, love: 2, music: 1, culture: 1 },
  night:     { philosophy: 2, religion: 2, controversial: 2, literature: 1, love: 1 },
};

/** A weighted random pick from `{ key: weight }`. */
export function weightedPick(weights, rand = Math.random) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (entries.length === 0) return null;
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r < 0) return key;
  }
  return entries[entries.length - 1][0];
}

/**
 * Choose a domain for the moment.
 *
 * A near holiday pre-empts with `seasonal` (Halloween wins on Oct 31 whatever the
 * hour). Otherwise draw from the band's weighted set, restricted to enabled
 * domains. Falls back to any enabled domain, then to `seasonal`.
 *
 * @param {object} calendar  from utils/calendar.js
 * @param {object} [opts]
 * @param {object} [opts.schedule] band → weighted domains
 * @param {string[]} [opts.domains] enabled palette
 * @param {function} [opts.rand]
 */
export function pickDomain(calendar, { schedule = DEFAULT_SCHEDULE, domains = DEFAULT_DOMAINS, rand = Math.random } = {}) {
  const enabled = new Set(domains);

  if (calendar?.nearbyHolidays?.length && enabled.has('seasonal')) {
    return 'seasonal';
  }

  const band = schedule[calendar?.timeOfDay] ?? {};
  const filtered = Object.fromEntries(
    Object.entries(band).filter(([d]) => enabled.has(d)),
  );

  return weightedPick(filtered, rand)
    ?? weightedPick(Object.fromEntries([...enabled].map(d => [d, 1])), rand)
    ?? 'seasonal';
}

/**
 * A play-log entry: what aired, when, whether it was enjoyed, and its terms.
 *
 * The recurrence theme signal (utils/recurrence.js) reads these to learn the
 * system's rhythms. Append-only and prunable by age; never shown in playback.
 */

/** Days of history to keep — long enough to reach "same date last year". */
export const PLAY_LOG_DAYS = Number(process.env.PLAY_LOG_DAYS || 400);

/** Build a log entry from a played document and its outcome. */
export function fromPlay(doc, { resolved = true, now = new Date() } = {}) {
  const terms = Array.isArray(doc?.subjects)
    ? doc.subjects.map(s => s.label).filter(Boolean)
    : (Array.isArray(doc?.labels) ? doc.labels.filter(Boolean) : []);

  return {
    key: doc?.key ?? null,
    terms: [...new Set(terms.map(t => String(t).toLowerCase()))],
    resolved: !!resolved,
    at: now,
    hour: now.getHours(),
    weekday: now.getDay(),
    dayOfYear: Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86_400_000),
  };
}

export default { PLAY_LOG_DAYS, fromPlay };

import MongoConnexion from './MongoConnexion.js';

/**
 * What played at analogous times.
 *
 * The system's own history is the strongest theme signal: if last October 31st was
 * pumpkins and last Sunday morning was landscapes, this year's matching slot should
 * lean the same way — learned rather than declared. We aggregate the lexicon of
 * plays in windows analogous to now, weighting by how well the window matches and
 * by whether the item was enjoyed (resolved) rather than skipped.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Analogous time windows around `now`, each with a weight (closer analogies count
 * more). Pure, so the aggregation is testable.
 */
export function windows(now = new Date()) {
  const t = now.getTime();
  return [
    { name: 'yesterday',      from: t - DAY - HOUR,      to: t - DAY + HOUR,      weight: 3 },
    { name: 'last-week',      from: t - 7 * DAY - HOUR,  to: t - 7 * DAY + HOUR,  weight: 2 },
    { name: 'last-month',     from: t - 30 * DAY - 2 * DAY, to: t - 30 * DAY + 2 * DAY, weight: 1.5 },
    { name: 'last-year',      from: t - 365 * DAY - 3 * DAY, to: t - 365 * DAY + 3 * DAY, weight: 1 },
  ];
}

/** A Mongo filter matching plays in any analogous window. */
export function analogousFilter(now = new Date()) {
  return { $or: windows(now).map(w => ({ at: { $gte: new Date(w.from), $lte: new Date(w.to) } })) };
}

/**
 * Aggregate a weighted term lexicon from plays. Pure.
 * @param {{terms:string[], resolved:boolean, at:Date|number}[]} plays
 * @returns {{label:string, score:number}[]} sorted strongest-first
 */
export function weightPlays(plays, now = new Date()) {
  const wins = windows(now);
  const scores = new Map();

  for (const play of plays) {
    const at = play.at instanceof Date ? play.at.getTime() : Number(play.at);
    // The best-matching window this play falls in.
    let w = 0;
    for (const win of wins) {
      if (at >= win.from && at <= win.to) w = Math.max(w, win.weight);
    }
    if (w === 0) continue;

    const enjoyment = play.resolved ? 2 : 1;
    for (const term of play.terms ?? []) {
      if (!term) continue;
      scores.set(term, (scores.get(term) ?? 0) + w * enjoyment);
    }
  }

  return [...scores.entries()]
    .map(([label, score]) => ({ label, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Build the recurrence lexicon from the play log.
 * @returns {Promise<string[]>} the top terms, strongest-first (empty at cold start)
 */
export async function build({ now = new Date(), limit = 10 } = {}) {
  const db = await MongoConnexion.db();
  const plays = await db.collection('plays')
    .find(analogousFilter(now), { projection: { terms: 1, resolved: 1, at: 1 } })
    .toArray();

  return weightPlays(plays, now).slice(0, limit).map(t => t.label);
}

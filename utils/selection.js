/**
 * How the next item is chosen.
 *
 * Selection is proportional to `weight × recency`, so a liked item comes up more
 * often than a disliked one, and a recent item more often than an old one.
 *
 * The draw uses the Efraimidis–Spirakis trick: give each candidate a key of
 * `random ^ (1 / score)` and take the largest. That selects each document with
 * probability proportional to its score in a single pass, which `$sample` cannot
 * do — `$sample` is uniform, so before this every document above the weight
 * threshold was equally likely regardless of how much it was liked.
 */

/** Days for a document's recency contribution to halve. */
export const HALF_LIFE_DAYS = Number(process.env.RECENCY_HALF_LIFE_DAYS || 1);

/**
 * Smallest recency multiplier, however old a document is.
 *
 * Without a floor the decay never stops: at a one-day half-life a month-old item
 * is 2^-30 as likely as a fresh one, which is never. The floor keeps the library
 * fully reachable — an old item is simply a tenth as likely as a new one, rather
 * than invisible — so the bias does not worsen as the library ages.
 */
export const RECENCY_FLOOR = Number(process.env.RECENCY_FLOOR ?? 0.1);

/** Set to 0 to select on weight alone, ignoring age. */
export const RECENCY_STRENGTH = Number(process.env.RECENCY_STRENGTH ?? 1);

/**
 * How often playback follows an edge rather than drawing from the whole library.
 *
 * Edge traversal gives the sequence its continuity, but the graph is biased toward
 * whatever has been around longest, so following it every time keeps new media out.
 * 1 restores pure traversal, 0 ignores the graph entirely.
 */
export const TRAVERSAL_PROBABILITY = Number(process.env.TRAVERSAL_PROBABILITY ?? 0.6);

/** Floor on score, since 1/score is undefined at zero. */
const MIN_SCORE = 1e-6;

/**
 * Aggregation stages that pick one document, favouring liked and recent ones.
 *
 * @param {object}  [options]
 * @param {number}  [options.threshold]   Weight cut-off; defaults to a fresh random draw
 * @param {number}  [options.halfLifeDays]
 * @param {number}  [options.strength]    0 disables the recency term entirely
 * @param {number}  [options.floor]       Lowest recency multiplier, so nothing becomes unreachable
 * @param {string[]} [options.keys]      Restrict the draw to these document keys
 * @param {Date}    [options.now]         Injectable for tests
 */
export function selectionPipeline({
  threshold = Math.random(),
  keys = null,
  halfLifeDays = HALF_LIFE_DAYS,
  strength = RECENCY_STRENGTH,
  floor = RECENCY_FLOOR,
  now = new Date(),
} = {}) {
  // An ObjectId encodes its creation time, so age needs no stored timestamp and
  // works for documents written before any of this existed.
  const ageDays = {
    $divide: [{ $subtract: [now, { $toDate: '$_id' }] }, 86_400_000],
  };

  // 2^(-age / halfLife): 1.0 when new, 0.5 after one half-life, and so on.
  const decay = {
    $pow: [
      2,
      { $multiply: [-strength, { $divide: [ageDays, Math.max(0.0001, halfLifeDays)] }] },
    ],
  };

  const recency = strength > 0 ? { $max: [floor, decay] } : 1;

  const match = { weight: { $gt: threshold } };
  if (keys) match.key = { $in: keys };

  return [
    { $match: match },
    {
      $addFields: {
        _score: {
          $max: [MIN_SCORE, { $multiply: [{ $ifNull: ['$weight', 0] }, recency] }],
        },
      },
    },
    { $addFields: { _draw: { $pow: [{ $rand: {} }, { $divide: [1, '$_score'] }] } } },
    { $sort: { _draw: -1 } },
    { $limit: 1 },
    { $unset: ['_score', '_draw'] },
  ];
}

/** Same draw with no weight threshold, for when nothing clears it. */
export function fallbackPipeline(options = {}) {
  return selectionPipeline({ ...options, threshold: -1 });
}

/**
 * Draw among the targets of the current item's edges.
 *
 * Traversal used to pick an edge uniformly at random, so following the graph
 * ignored both weight and age — and because almost every document has outgoing
 * edges, that was the great majority of plays. No weight threshold here: the edge
 * already decided these are candidates, so weight only orders them.
 */
export function traversalPipeline(keys, options = {}) {
  return selectionPipeline({ ...options, keys, threshold: -1 });
}

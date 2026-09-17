import MongoConnexion from '../utils/MongoConnexion.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/** Fields a document may be ordered by. Anything else is rejected. */
const SORTABLE = new Set(['name', 'weight', 'type', 'key']);

/**
 * A page of the indexed library, as metadata only.
 *
 * Deliberately returns no media: `play` base64-encodes whole files into its
 * socket message, and a page of those would be unusable. The list carries just
 * enough to identify and choose an item.
 *
 * @param {object}  params
 * @param {number} [params.skip=0]
 * @param {number} [params.limit=25]
 * @param {string} [params.sort='name']   name | weight | type | key
 * @param {number} [params.order=1]       1 ascending, -1 descending
 * @param {string} [params.type]          filter by MIME prefix, e.g. "image"
 * @param {string} [params.search]        case-insensitive substring of the name
 * @returns {Promise<{items: object[], total: number, skip: number, limit: number}>}
 */
async function list({ skip = 0, limit = DEFAULT_LIMIT, sort = 'name', order = 1, type, search } = {}) {
  const db = await MongoConnexion.db();
  const col = db.collection('data');

  const safeSkip = Math.max(0, Number(skip) || 0);
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  const sortField = SORTABLE.has(sort) ? sort : 'name';
  const sortOrder = Number(order) === -1 ? -1 : 1;

  const query = {};
  if (type) query.type = { $regex: `^${escapeRegExp(String(type))}`, $options: 'i' };
  if (search) query.name = { $regex: escapeRegExp(String(search)), $options: 'i' };

  const [items, total] = await Promise.all([
    col
      .find(query, {
        // Metadata only — never the file contents.
        projection: { _id: 0, key: 1, name: 1, type: 1, weight: 1, generator: 1, derivedFrom: 1, label: 1 },
      })
      .sort({ [sortField]: sortOrder })
      .skip(safeSkip)
      .limit(safeLimit)
      .toArray(),
    col.countDocuments(query),
  ]);

  return { items, total, skip: safeSkip, limit: safeLimit, sort: sortField, order: sortOrder };
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default list;

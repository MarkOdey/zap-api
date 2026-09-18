import MongoConnexion from '../utils/MongoConnexion.js';

/** Accepts a bare key (CLI) or {key} (terminal and queue), which pass differently. */
async function find(params) {
  const key = typeof params === 'string' ? params : params?.key;
  if (typeof key !== 'string' || !key.trim()) {
    // A bare `--key` flag parses to boolean true, so say what arrived rather than
    // just "required" — the caller did pass something.
    throw new Error(`find: key must be a non-empty string, got ${describeValue(key)}`);
  }

  console.log('finding data with key:', key);
  const db = await MongoConnexion.db();
  const col = db.collection('data');
  const data = await col.findOne({ key });
  console.log('found asset:', data?.source ?? '(not found)');
  return data;
}

const describeValue = (v) =>
  v === undefined ? 'nothing'
    : v === null ? 'null'
      : typeof v === 'object' ? 'an object'
        : `${typeof v} (${JSON.stringify(v)})`;

export default find;
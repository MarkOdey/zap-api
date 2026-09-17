import MongoConnexion from '../utils/MongoConnexion.js';

/** Accepts a bare key (CLI) or {key} (terminal and queue), which pass differently. */
async function find(params) {
  const key = typeof params === 'string' ? params : params?.key;
  if (!key) throw new Error('find: key is required');

  console.log('finding data with key:', key);
  const db = await MongoConnexion.db();
  const col = db.collection('data');
  const data = await col.findOne({ key });
  console.log('found asset:', data?.source ?? '(not found)');
  return data;
}

export default find;
import MongoConnexion from '../utils/MongoConnexion.js';

async function traverse({ key, type, direction } = {}) {
  if (!key) {
    console.warn('traverse: key is required');
    return [];
  }
  const db = await MongoConnexion.db();
  const col = db.collection('edges');

  let query;
  if (direction === 'from') {
    query = { from: key };
  } else if (direction === 'to') {
    query = { to: key };
  } else {
    query = { $or: [{ from: key }, { to: key }] };
  }

  if (type) query = { ...query, type };

  const edges = await col.find(query).toArray();
  console.log('traverse:', key, '→', edges.length, 'edges');
  return edges;
}

export default traverse;
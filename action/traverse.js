const MongoConnexion = require('../utils/MongoConnexion');

async function traverse({ key, type, direction } = {}) {
  if (!key) {
    console.warn('traverse: key is required');
    return [];
  }
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('edges');

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

module.exports = traverse;

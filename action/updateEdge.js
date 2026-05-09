const MongoConnexion = require('../utils/MongoConnexion');

async function updateEdge({ key, weight }) {
  if (!key) {
    console.warn('updateEdge: no key provided, skipping');
    return;
  }
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('edges');
  await col.updateOne({ key }, { $set: { weight } });
  console.log('edge weight updated:', key, '→', weight);
}

module.exports = updateEdge;

import MongoConnexion from '../utils/MongoConnexion.js';

async function updateEdge({ key, weight }) {
  if (!key) {
    console.warn('updateEdge: no key provided, skipping');
    return;
  }
  const db = await MongoConnexion.db();
  const col = db.collection('edges');
  await col.updateOne({ key }, { $set: { weight } });
  console.log('edge weight updated:', key, '→', weight);
}

export default updateEdge;
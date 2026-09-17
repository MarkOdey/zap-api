import MongoConnexion from '../utils/MongoConnexion.js';

async function connect({ from, to, type, weight = 0.5 } = {}) {
  if (!from || !to || !type) {
    console.warn('connect: from, to, and type are required');
    return;
  }
  const db = await MongoConnexion.db();
  const col = db.collection('edges');

  const key = `${from}::${type}::${to}`;
  const doc = { key, from, to, type, weight };

  await col.updateOne({ key }, { $set: doc }, { upsert: true });
  console.log('edge connected:', key);
  return doc;
}

export default connect;
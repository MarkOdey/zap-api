const MongoConnexion = require('../utils/MongoConnexion');

async function connect({ from, to, type, weight = 0.5 } = {}) {
  if (!from || !to || !type) {
    console.warn('connect: from, to, and type are required');
    return;
  }
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('edges');

  const key = `${from}::${type}::${to}`;
  const doc = { key, from, to, type, weight };

  await col.updateOne({ key }, { $set: doc }, { upsert: true });
  console.log('edge connected:', key);
  return doc;
}

module.exports = connect;

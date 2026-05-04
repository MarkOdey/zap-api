const MongoConnexion = require('../utils/MongoConnexion');

async function record(data) {
  if (!data.key) throw new Error('record: no key specified');
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('data');
  data.weight = data.weight ?? Math.random();
  await col.updateOne({ key: data.key }, { $set: data }, { upsert: true });
  console.log('record updated:', data.key);
}

module.exports = record;

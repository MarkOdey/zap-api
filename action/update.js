const MongoConnexion = require('../utils/MongoConnexion');

async function update(data) {
  if (!data.key) {
    console.warn('update: no key on data, skipping');
    return;
  }
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('data');
  await col.updateOne({ key: data.key }, { $set: { weight: data.weight } });
  console.log('data updated:', data.key);
}

module.exports = update;

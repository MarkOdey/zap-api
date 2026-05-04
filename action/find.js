const MongoConnexion = require('../utils/MongoConnexion');

async function find(key) {
  console.log('finding data with key:', key);
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('data');
  const data = await col.findOne({ key });
  console.log('found asset:', data?.SourceFile);
  return data;
}

module.exports = find;

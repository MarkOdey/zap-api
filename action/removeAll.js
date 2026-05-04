const MongoConnexion = require('../utils/MongoConnexion');

async function removeAll() {
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('data');
  const result = await col.deleteMany({});
  console.log('removed', result.deletedCount, 'assets');
}

module.exports = removeAll;

const MongoConnexion = require('../utils/MongoConnexion');

async function disconnect({ from, to, type } = {}) {
  if (!from || !to || !type) {
    console.warn('disconnect: from, to, and type are required');
    return;
  }
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('edges');

  const key = `${from}::${type}::${to}`;
  await col.deleteOne({ key });
  console.log('edge disconnected:', key);
}

module.exports = disconnect;

const MongoConnexion = require('../utils/MongoConnexion');

const PRUNE_THRESHOLD = 0.1;

async function pruneTask() {
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('edges');
  const result = await col.deleteMany({ weight: { $lt: PRUNE_THRESHOLD } });
  if (result.deletedCount > 0) {
    console.log('prune: removed', result.deletedCount, 'low-weight edges');
  }
}

module.exports = pruneTask;

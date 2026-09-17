import MongoConnexion from '../utils/MongoConnexion.js';

const PRUNE_THRESHOLD = 0.1;

async function pruneTask() {
  const db = await MongoConnexion.db();
  const col = db.collection('edges');
  const result = await col.deleteMany({ weight: { $lt: PRUNE_THRESHOLD } });
  if (result.deletedCount > 0) {
    console.log('prune: removed', result.deletedCount, 'low-weight edges');
  }
}

export default pruneTask;
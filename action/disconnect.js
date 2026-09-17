import MongoConnexion from '../utils/MongoConnexion.js';

async function disconnect({ from, to, type } = {}) {
  if (!from || !to || !type) {
    console.warn('disconnect: from, to, and type are required');
    return;
  }
  const db = await MongoConnexion.db();
  const col = db.collection('edges');

  const key = `${from}::${type}::${to}`;
  await col.deleteOne({ key });
  console.log('edge disconnected:', key);
}

export default disconnect;
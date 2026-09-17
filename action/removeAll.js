import MongoConnexion from '../utils/MongoConnexion.js';

async function removeAll() {
  const db = await MongoConnexion.db();
  const col = db.collection('data');
  const result = await col.deleteMany({});
  console.log('removed', result.deletedCount, 'assets');
}

export default removeAll;
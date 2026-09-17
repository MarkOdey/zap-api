import MongoConnexion from '../utils/MongoConnexion.js';

async function find(key) {
  console.log('finding data with key:', key);
  const db = await MongoConnexion.db();
  const col = db.collection('data');
  const data = await col.findOne({ key });
  console.log('found asset:', data?.source ?? '(not found)');
  return data;
}

export default find;
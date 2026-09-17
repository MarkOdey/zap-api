import MongoConnexion from '../utils/MongoConnexion.js';

async function update(data) {
  if (!data.key) {
    console.warn('update: no key on data, skipping');
    return;
  }
  const db = await MongoConnexion.db();
  const col = db.collection('data');
  await col.updateOne({ key: data.key }, { $set: { weight: data.weight } });
  console.log('data updated:', data.key);
}

export default update;
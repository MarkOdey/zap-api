import MongoConnexion from '../utils/MongoConnexion.js';
import { normalize, validate } from '../model/document.js';

async function record(data) {
  if (!data?.key) throw new Error('record: no key specified');

  const doc = normalize(data);
  const { valid, errors } = validate(doc);
  if (!valid) throw new Error(`record: invalid document ${doc.key} — ${errors.join('; ')}`);

  const db = await MongoConnexion.db();
  const col = db.collection('data');
  await col.updateOne({ key: doc.key }, { $set: doc }, { upsert: true });
  console.log('record updated:', doc.key);
}

export default record;
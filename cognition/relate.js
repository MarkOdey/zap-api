import MongoConnexion from '../utils/MongoConnexion.js';
import connect from '../action/connect.js';
import TYPES from '../relation/statement.js';

const typeValues = Object.values(TYPES);

async function relateTask() {
  const db = await MongoConnexion.db();
  const col = db.collection('data');

  const items = await col.aggregate([{ $sample: { size: 2 } }]).toArray();
  if (items.length < 2) return;

  const [a, b] = items;
  const type = typeValues[Math.floor(Math.random() * typeValues.length)];

  await connect({ from: a.key, to: b.key, type, weight: 0.5 });
}

export default relateTask;
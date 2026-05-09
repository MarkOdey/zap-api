const MongoConnexion = require('../utils/MongoConnexion');
const connect = require('../action/connect');
const TYPES = require('../relation/statement');

const typeValues = Object.values(TYPES);

async function relateTask() {
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('data');

  const items = await col.aggregate([{ $sample: { size: 2 } }]).toArray();
  if (items.length < 2) return;

  const [a, b] = items;
  const type = typeValues[Math.floor(Math.random() * typeValues.length)];

  await connect({ from: a.key, to: b.key, type, weight: 0.5 });
}

module.exports = relateTask;

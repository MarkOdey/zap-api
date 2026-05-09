const MongoConnexion = require('../utils/MongoConnexion');
const update = require('./update');
const updateEdge = require('./updateEdge');

async function appreciate({ key, edgeKey, delta }) {
  if (!key) return;

  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('data');
  const data = await col.findOne({ key });
  if (!data) return;

  data.weight = delta > 0
    ? Math.min(1, (data.weight ?? 0.5) + delta)
    : Math.max(0, (data.weight ?? 0.5) + delta);

  await update(data);
  console.log('appreciate: data weight →', data.weight, '(delta', delta, ')');

  if (edgeKey) {
    const edgeCol = mongoclient.db('zap').collection('edges');
    const edge = await edgeCol.findOne({ key: edgeKey });
    if (edge) {
      const newWeight = delta > 0
        ? Math.min(1, (edge.weight ?? 0.5) + delta)
        : Math.max(0, (edge.weight ?? 0.5) + delta);
      await updateEdge({ key: edgeKey, weight: newWeight });
    }
  }
}

module.exports = appreciate;

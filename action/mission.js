import MongoConnexion from '../utils/MongoConnexion.js';
import promptTask from '../cognition/prompt.js';

/**
 * Read and manage missions.
 * @param {object} params  { op: 'list'|'get'|'generate'|'dismiss', key? }
 */
async function mission(params = {}) {
  const op = (typeof params === 'string' ? params : params?.op) || 'list';
  const db = await MongoConnexion.db();
  const col = db.collection('missions');

  if (op === 'list') {
    const missions = await col.find({ status: 'open' }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 }).toArray();
    return { missions };
  }

  if (op === 'get') {
    return col.findOne({ key: params.key }, { projection: { _id: 0 } });
  }

  if (op === 'generate') {
    const m = await promptTask();
    return m ? { ok: true, mission: m } : { ok: false, reason: 'pool full or generation skipped' };
  }

  if (op === 'dismiss') {
    if (!params.key) throw new Error('mission: dismiss needs a key');
    const r = await col.updateOne({ key: params.key }, { $set: { status: 'dismissed' } });
    return { dismissed: r.modifiedCount };
  }

  throw new Error(`mission: unknown op ${op}`);
}

export default mission;

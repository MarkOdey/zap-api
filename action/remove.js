import fs from 'fs/promises';
import path from 'path';

import MongoConnexion from '../utils/MongoConnexion.js';

/**
 * Delete a media item: its file, its document, and every edge touching it.
 *
 * prune deliberately never deletes uploads, so this is the way to remove
 * something you put in yourself.
 *
 * Derivatives are left alone by default. A cutout is its own file and may be
 * worth keeping after the photo it came from has gone; `cascade` removes them
 * too, following derivedFrom to any depth.
 *
 * @param {object|string} params            A key, or {key, cascade}
 * @param {boolean}      [params.cascade]   Also remove anything derived from it
 * @returns {Promise<{removed: string[], files: number, edges: number}>}
 */
async function remove(params) {
  const key = typeof params === 'string' ? params : params?.key;
  const cascade = typeof params === 'object' ? !!params.cascade : false;

  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('remove: key must be a non-empty string');
  }

  const db = await MongoConnexion.db();
  const col = db.collection('data');
  const edgeCol = db.collection('edges');

  const doc = await col.findOne({ key });
  if (!doc) throw new Error(`remove: no document for key ${key}`);

  const keys = cascade ? await withDerivatives(col, key) : [key];
  const docs = await col.find({ key: { $in: keys } }).toArray();

  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  let files = 0;

  for (const d of docs) {
    if (!d.source) continue;
    const file = path.resolve(d.source);

    // Same containment rule as the media route: a poisoned record must not be
    // able to delete outside the media directory.
    if (file !== dataDir && !file.startsWith(dataDir + path.sep)) {
      console.warn('remove: refusing to delete outside DATA_DIR:', d.source);
      continue;
    }

    try {
      await fs.unlink(file);
      files++;
    } catch {
      // Already gone; the document still needs clearing.
    }
  }

  const { deletedCount: edges } = await edgeCol.deleteMany({
    $or: [{ from: { $in: keys } }, { to: { $in: keys } }],
  });
  await col.deleteMany({ key: { $in: keys } });

  console.log(`remove: ${keys.length} document(s), ${files} file(s), ${edges} edge(s) — ${key}`);
  return { removed: keys, files, edges };
}

/** Collect a key and everything derived from it, at any depth. */
async function withDerivatives(col, root) {
  const found = new Set([root]);
  let frontier = [root];

  while (frontier.length) {
    const children = await col
      .find({ derivedFrom: { $in: frontier } }, { projection: { key: 1 } })
      .toArray();

    frontier = children.map(c => c.key).filter(k => !found.has(k));
    for (const k of frontier) found.add(k);
  }

  return [...found];
}

export default remove;

import fs from 'fs/promises';
import path from 'path';
import MongoConnexion from '../utils/MongoConnexion.js';
import { normalize, validate, mediaKind } from '../model/document.js';
import { describeMedia } from '../utils/ffprobe.js';

/**
 * Probe a video for the facts the broadcast and selection need — but only when
 * they are missing or the file has changed since it was last probed, so a rescan
 * of an unchanged library spawns no ffprobe processes. Returns the fields to
 * store, or null if nothing needs probing (or probing failed).
 */
export async function videoMetadata(existing, filePath, stat, describe) {
  const known = existing && existing.hasAudio !== undefined;
  const unchanged = existing && existing.mtimeMs === stat.mtimeMs;
  if (known && unchanged) return null;

  try {
    const { hasAudio, duration, width, height } = await describe(filePath);
    return { hasAudio, duration, width, height, mtimeMs: stat.mtimeMs };
  } catch (err) {
    // No ffprobe, or an unreadable file — index it anyway; the broadcast's
    // on-air audio guard is the safety net until a later probe succeeds.
    console.warn("explore: could not probe", filePath, "—", err.message);
    return null;
  }
}

async function explore(params = {}) {
  // The prober is injectable so tests need no ffprobe binary.
  const describe = params?.describe || describeMedia;

  const db = await MongoConnexion.db();
  const col = db.collection("data");
  const dataDir = process.env.DATA_DIR || "./data";

  let files;
  try {
    files = await fs.readdir(dataDir);
  } catch (e) {
    console.error("explore: cannot read data dir", dataDir, e.message);
    return;
  }

  const EXCLUDED_EXTENSIONS = new Set([".mov"]);

  let indexed = 0;
  let skipped = 0;

  for (const filename of files) {
    if (EXCLUDED_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
      console.log("explore: skipping", filename);
      skipped++;
      continue;
    }
    const filePath = path.join(dataDir, filename);
    const doc = normalize({ source: filePath, name: filename });

    const { valid, errors } = validate(doc);
    if (!valid) {
      console.warn("explore: skipping invalid document", filename, "—", errors.join("; "));
      skipped++;
      continue;
    }

    // Refresh the file fields, but let `weight` be set only on insert — $set-ing
    // the whole document re-randomized every weight on every scan, destroying
    // every like and dislike the session loop had accumulated.
    const { weight, ...fields } = doc;

    // Video docs carry probe metadata (hasAudio/duration/dimensions) so the
    // broadcast can require audio and selection can filter on it. Probed lazily.
    if (mediaKind(doc) === 'video') {
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch { /* stat failed — skip metadata, index the rest */ }
      if (stat) {
        const existing = await col.findOne(
          { key: doc.key },
          { projection: { hasAudio: 1, mtimeMs: 1 } },
        );
        const meta = await videoMetadata(existing, filePath, stat, describe);
        if (meta) Object.assign(fields, meta);
      }
    }

    await col.updateOne(
      { key: doc.key },
      { $set: fields, $setOnInsert: { weight } },
      { upsert: true },
    );
    indexed++;
    console.log("indexed:", filename);
  }

  console.log(`explore: done — ${indexed} indexed, ${skipped} skipped, ${files.length} seen`);
}

export default explore;
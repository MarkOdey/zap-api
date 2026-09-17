import fs from 'fs/promises';
import path from 'path';
import MongoConnexion from '../utils/MongoConnexion.js';
import { normalize, validate } from '../model/document.js';

async function explore() {
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
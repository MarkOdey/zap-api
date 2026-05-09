const fs = require("fs").promises;
const path = require("path");
const mime = require("mime");
const MongoConnexion = require("../utils/MongoConnexion");

async function explore() {
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db("zap").collection("data");
  const dataDir = process.env.DATA_DIR || "./data";

  let files;
  try {
    files = await fs.readdir(dataDir);
  } catch (e) {
    console.error("explore: cannot read data dir", dataDir, e.message);
    return;
  }

  const EXCLUDED_EXTENSIONS = new Set([".mov"]);

  for (const filename of files) {
    if (EXCLUDED_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
      console.log("explore: skipping", filename);
      continue;
    }
    const filePath = path.join(dataDir, filename);
    const doc = {
      key: filePath,
      name: filename,
      source: filePath,
      type: mime.getType(filename) || "",
      weight: Math.random(),
    };

    await col.updateOne({ key: doc.key }, { $set: doc }, { upsert: false });
    console.log("indexed:", filename);
  }

  console.log("explore: done indexing", files.length, "files");
}

module.exports = explore;

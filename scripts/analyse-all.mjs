/**
 * Analyse every image that has no labels yet.
 *
 * The queue runs `analyse` one job at a time in a fresh subprocess, which is right
 * for unattended work — the 4.3GB model's memory goes back when the process exits.
 * It is the wrong shape for a backlog: paying that load once per image would dwarf
 * the inference itself. This loads the model once and walks the whole set.
 *
 * Run it on the host, not in Docker. Segmentation peaks around 4.3GB and the
 * Docker Desktop VM has 5.62GB in total, so the container gets SIGKILLed partway
 * through the model load — `--memory` does not help, there is no memory to give.
 * Point MONGO_URL at the published port and it reads the same library:
 *
 *   MONGO_URL=mongodb://localhost:27018/zap node scripts/analyse-all.mjs
 *   MONGO_URL=mongodb://localhost:27018/zap node scripts/analyse-all.mjs 20
 *
 * The second form stops after 20, for sampling timing. Reckon on ~10s an image
 * once the model is up, plus about 15s to load it.
 *
 * Resumable: it selects on the absence of `labels`, so anything already done is
 * skipped and it can be interrupted at any point. Images it cannot read are marked
 * so a rerun does not keep retrying them.
 */
import analyse from '../action/analyse.js';
import MongoConnexion from '../utils/MongoConnexion.js';

const limit = Number(process.argv[2]) || 0;

const db = await MongoConnexion.db();
const col = db.collection('data');

/** Images with no labels and no recorded failure. Oldest first: uploads before derivatives. */
const query = { type: /^image\//, labels: { $exists: false }, analyseFailed: { $exists: false } };
const cursor = col.find(query, { projection: { key: 1 } }).sort({ _id: 1 });
const pending = await (limit ? cursor.limit(limit) : cursor).toArray();

const total = pending.length;
console.log(`analyse-all: ${total} image(s) to do\n`);

let done = 0;
let failed = 0;
let labelled = 0;
let empty = 0;
const startedAt = Date.now();
const histogram = new Map();

for (const { key } of pending) {
  const at = Date.now();
  try {
    const { labels } = await analyse({ key });
    if (labels.length) {
      labelled++;
      for (const label of labels) histogram.set(label, (histogram.get(label) ?? 0) + 1);
    } else {
      empty++;
    }
  } catch (err) {
    failed++;
    // Record the reason on the document. Without this the next run picks the same
    // unreadable file up again and fails on it just as slowly.
    await col.updateOne({ key }, { $set: { analyseFailed: err.message, analysedAt: new Date() } });
    console.warn(`analyse-all: ${key} failed — ${err.message}`);
  }

  done++;
  const each = (Date.now() - startedAt) / done;
  const left = ((total - done) * each) / 1000;
  console.log(
    `  ${String(done).padStart(4)}/${total}` +
    `  ${((Date.now() - at) / 1000).toFixed(1)}s` +
    `  ${left > 90 ? `${(left / 60).toFixed(0)}m` : `${left.toFixed(0)}s`} left`,
  );
}

const minutes = (Date.now() - startedAt) / 60000;
console.log(`\nanalyse-all: ${done} in ${minutes.toFixed(1)}m — ${labelled} labelled, ${empty} nothing nameable, ${failed} failed`);

if (histogram.size) {
  console.log('\nmost common subjects:');
  [...histogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([label, count]) => console.log(`  ${String(count).padStart(4)}  ${label}`));
}

await MongoConnexion.close();

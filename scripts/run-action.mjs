/**
 * Run one action in its own process.
 *
 * Imports the registry rather than index.js, so no socket server is started.
 *
 * Exists because ONNX inference is CPU-bound and synchronous: run in the API
 * process it blocked the event loop for seconds at a time — a trivial request went
 * from 5ms to over 7 seconds — which stalled playback while a job ran. Out here it
 * cannot, and the process exiting also returns the model's memory.
 *
 *   node scripts/run-action.mjs isolate '{"key":"data/a.jpg"}'
 */
import { COMMANDS } from '../action/registry.js';
import MongoConnexion from '../utils/MongoConnexion.js';

const [name, raw] = process.argv.slice(2);

if (!name || !COMMANDS[name]) {
  console.error(`run-action: unknown action ${name}`);
  process.exit(2);
}

let params = {};
if (raw) {
  try {
    params = JSON.parse(raw);
  } catch (err) {
    console.error('run-action: invalid JSON parameter:', err.message);
    process.exit(2);
  }
}

try {
  const result = await COMMANDS[name](params);
  // The parent reads this line to recover the return value.
  process.stdout.write(`\n__RESULT__${JSON.stringify(result ?? null)}\n`);
  await MongoConnexion.close();
  process.exit(0);
} catch (err) {
  console.error(err.message);
  await MongoConnexion.close().catch(() => {});
  process.exit(1);
}

import { MongoClient } from 'mongodb';

let client = null;
let connectPromise = null;

function get() {
  if (client) return Promise.resolve(client);
  if (!connectPromise) {
    const url = process.env.MONGO_URL || 'mongodb://localhost:27017/zap';
    connectPromise = MongoClient.connect(url)
      .then(c => { client = c; return c; })
      .catch(err => {
        connectPromise = null;
        throw err;
      });
  }
  return connectPromise;
}

/**
 * The database to use, taken from the path of MONGO_URL (or MONGO_DB), falling
 * back to 'zap'. Call sites must not hardcode a name, or tests cannot be
 * isolated from the real library.
 */
function dbName() {
  if (process.env.MONGO_DB) return process.env.MONGO_DB;
  const url = process.env.MONGO_URL || '';
  const match = url.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  return match?.[1] || 'zap';
}

/** Get the configured database, connecting if necessary. */
async function db() {
  const client = await get();
  return client.db(dbName());
}

/** Close the shared client. Used by tests and for clean shutdown. */
async function close() {
  const c = client;
  client = null;
  connectPromise = null;
  if (c) await c.close();
}

export default { get, db, dbName, close };

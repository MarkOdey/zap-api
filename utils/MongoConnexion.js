const { MongoClient } = require('mongodb');

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

module.exports = { get };

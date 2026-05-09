const fs = require("fs").promises;
const MongoConnexion = require("../utils/MongoConnexion");
const update = require("./update.js");

async function play(session) {
  if (!session?.socket) return;

  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db("zap").collection("data");
  const edgeCol = mongoclient.db("zap").collection("edges");

  let data = null;
  let precedingEdge = null;

  // Try edge traversal from the previous item
  if (session.currentKey) {
    const edges = await edgeCol.find({ from: session.currentKey }).toArray();
    if (edges.length > 0) {
      const edge = edges[Math.floor(Math.random() * edges.length)];
      const candidate = await col.findOne({ key: edge.to });
      if (candidate) {
        data = candidate;
        precedingEdge = edge;
        console.log("play: traversing edge", edge.key);
      }
    }
  }

  // Fallback: weighted random selection
  if (!data) {
    data = await col.findOne({ weight: { $gt: Math.random() } });
    if (!data) data = await col.findOne({});
  }

  if (!data) {
    console.log("play: collection is empty — run 'node index.js explore' first");
    await new Promise(resolve => setTimeout(resolve, 5000));
    return;
  }

  let src;
  try {
    const buffer = await fs.readFile(data.source);
    src = `data:${data.type};base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.warn("play: could not read file", data.source, err.message);
    return;
  }

  // Track session state for like/dislike handlers
  session.currentKey = data.key;
  session.precedingEdge = precedingEdge;

  console.log("play: emitting", data.source);
  session.socket.emit("play", { ...data, src });

  // Wait for playback completion signal (resolve/reject)
  await new Promise((resolve) => {
    session.socket.once("resolve", () => resolve("resolve"));
    session.socket.once("reject",  () => resolve("reject"));
  });
}

module.exports = play;

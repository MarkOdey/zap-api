const fs = require("fs").promises;
const MongoConnexion = require("../utils/MongoConnexion");
const update = require("./update.js");

async function play(session) {
  if (!session?.socket) return;

  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db("zap").collection("data");

  // Weighted selection: higher-weight items pass the random threshold more often.
  // Fallback to any document when the threshold is above all weights.
  let data = await col.findOne({ weight: { $gt: Math.random() } });
  if (!data) data = await col.findOne({});

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

  console.log("play: emitting", data.source);
  session.socket.emit("play", { ...data, src });

  // Wait for the client to signal completion
  const verdict = await new Promise((resolve) => {
    session.socket.once("resolve", () => resolve("resolve"));
    session.socket.once("reject", () => resolve("reject"));
  });

  const current = data.weight ?? 0.5;
  data.weight =
    verdict === "resolve"
      ? Math.min(1, current + 0.1)
      : Math.max(0, current - 0.1);

  await update(data);
  console.log("play: weight updated to", data.weight, "(", verdict, ")");
}

module.exports = play;

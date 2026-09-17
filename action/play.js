import fs from 'fs/promises';
import { mediaUrl } from '../utils/mediaRoute.js';
import { SOUNDTRACK } from '../relation/statement.js';
import MongoConnexion from '../utils/MongoConnexion.js';
import update from './update.js';

async function play(session) {
  if (!session?.socket) return;

  const db = await MongoConnexion.db();
  const col = db.collection("data");
  const edgeCol = db.collection("edges");

  let data = null;
  let precedingEdge = null;

  // A click in the list sets forcedKey. It wins over both edge traversal and
  // weighted selection, and is consumed once so the loop resumes normally after.
  if (session.forcedKey) {
    const forced = await col.findOne({ key: session.forcedKey });
    session.forcedKey = null;
    if (forced) {
      data = forced;
      console.log('play: forced', forced.key);
    } else {
      console.warn('play: forced key not found', session.forcedKey);
    }
  }

  // Try edge traversal from the previous item
  if (!data && session.currentKey) {
    // Soundtrack edges pair a document with audio; they are not a route to the
    // next item, so they must not be traversed.
    const edges = await edgeCol
      .find({ from: session.currentKey, type: { $ne: SOUNDTRACK } })
      .toArray();
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

  // Fallback: weighted random selection.
  //
  // $sample is load-bearing. findOne() has no sort, so it returns the *first*
  // match in natural order — meaning a document was only ever reachable if its
  // weight exceeded every weight before it in the collection. That left 4 of 47
  // documents reachable here, and the rest unplayable.
  if (!data) {
    const [hit] = await col.aggregate([
      { $match: { weight: { $gt: Math.random() } } },
      { $sample: { size: 1 } },
    ]).toArray();
    data = hit;

    // Nothing outscored the threshold — take any document, still at random.
    if (!data) {
      const [any] = await col.aggregate([{ $sample: { size: 1 } }]).toArray();
      data = any;
    }
  }

  if (!data) {
    console.log("play: collection is empty — run 'node index.js explore' first");
    await new Promise(resolve => setTimeout(resolve, 5000));
    return;
  }

  // Confirm the file is there, then hand over a URL rather than its bytes.
  // Base64-over-socket could not stream or seek and sent whole files as single
  // messages — the library's largest is 95MB. The client fetches /media/:key.
  try {
    await fs.access(data.source);
  } catch (err) {
    console.warn("play: could not read file", data.source, err.message);
    return;
  }
  const src = mediaUrl(data.key);

  // A3: a still can carry a soundtrack. Linked by edge rather than by changing the
  // document schema, which would break the one-file-one-document assumption in
  // explore, record, find and list.
  let audio = null;
  const track = await edgeCol.findOne({ from: data.key, type: SOUNDTRACK });
  if (track) {
    const audioDoc = await col.findOne({ key: track.to });
    if (audioDoc?.type?.includes('audio')) {
      audio = { key: audioDoc.key, name: audioDoc.name, src: mediaUrl(audioDoc.key) };
      console.log('play: with soundtrack', audioDoc.key);
    }
  }

  // Track session state for like/dislike handlers
  session.currentKey = data.key;
  session.precedingEdge = precedingEdge;

  console.log("play: emitting", data.source);
  session.socket.emit("play", { ...data, src, audio });

  // Wait for playback completion signal (resolve/reject)
  await new Promise((resolve) => {
    session.socket.once("resolve", () => resolve("resolve"));
    session.socket.once("reject",  () => resolve("reject"));
  });
}

export default play;
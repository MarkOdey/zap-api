import fs from 'fs/promises';
import { mediaUrl } from '../utils/mediaRoute.js';
import { SOUNDTRACK } from '../relation/statement.js';
import { selectionPipeline, fallbackPipeline, traversalPipeline, TRAVERSAL_PROBABILITY } from '../utils/selection.js';
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

  // Follow the graph most of the time, but not always.
  //
  // relate has been adding edges since the library began, so older documents have
  // accumulated far more of them and new ones are rarely among a candidate set.
  // Weighting the draw within a set cannot fix that — measured, traversal alone
  // left the newest quarter of the library at a twelfth of plays. Skipping
  // traversal some of the time lets the recency-weighted draw reach everything.
  const followGraph = Math.random() < TRAVERSAL_PROBABILITY;

  // Try edge traversal from the previous item
  if (!data && followGraph && session.currentKey) {
    // Soundtrack edges pair a document with audio; they are not a route to the
    // next item, so they must not be traversed.
    const edges = await edgeCol
      .find({ from: session.currentKey, type: { $ne: SOUNDTRACK } })
      .toArray();

    if (edges.length > 0) {
      // Draw among the edge targets by weight and recency rather than picking an
      // edge uniformly. Nearly every document has outgoing edges, so this is the
      // path most plays take — a uniform pick here ignored both.
      const [candidate] = await col
        .aggregate(traversalPipeline(edges.map(e => e.to)))
        .toArray();

      if (candidate) {
        data = candidate;
        precedingEdge = edges.find(e => e.to === candidate.key) ?? null;
        console.log("play: traversing edge", precedingEdge?.key ?? candidate.key);
      }
    }
  }

  // Fallback: a draw weighted by how liked and how recent each document is.
  //
  // The pipeline matters. findOne() has no sort, so it returned the *first* match
  // in natural order — a document was only reachable if its weight exceeded every
  // weight before it, leaving 4 of 47 playable. $sample fixed reachability but is
  // uniform, so weight only decided whether a document qualified, never how often
  // it came up. See utils/selection.js.
  if (!data) {
    const [hit] = await col.aggregate(selectionPipeline()).toArray();
    data = hit;

    // Nothing cleared the threshold — draw again with it removed.
    if (!data) {
      const [any] = await col.aggregate(fallbackPipeline()).toArray();
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
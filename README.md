# zap-api

Backend engine for the Zap multimedia player. Manages a media library (video, image, text) stored in MongoDB. Control flows over Socket.IO; media bytes are served over HTTP with byte-range support.

The server runs a continuous loop: it selects the next most relevant media item using a weighted algorithm, pushes it to the connected client, waits for a completion signal (liked / finished / skipped), adjusts the item's weight accordingly, and repeats.

---

## Architecture

```
index.js              Entry point — registers actions, runs CLI invocation, bootstraps Cognition
session.js            Socket.IO server (port 3000); per-connection Session lifecycle and action queue
cognition.js          Background decision layer (stub)
action/
  play.js             Weighted random MongoDB query → emits 'play' event to client
  explore.js          Scans data/ dir, upserts file metadata into MongoDB
  find.js             Queries MongoDB by key
  update.js           Adjusts weight field on a document
  record.js           Upserts a document (used by upload pipeline)
  upload.js           Accepts base64-encoded file over socket, saves to data/
  crop.js             Trims a video segment via ffmpeg
  normalize.js        Re-encodes video to H.264/AAC via ffmpeg
  concat.js           Concatenates two media files via external binary
  removeAll.js        Drops all documents from data collection
model/
  document.js         Canonical document shape; validate / normalize / mediaKind
relation/
  statement.js        Edge type constants used by cognition/relate.js
utils/
  MongoConnexion.js   Singleton MongoDB client (reads MONGO_URL / MONGO_DB)
  queue.js            In-process job queue
  worker.js           Drains one queued job per tick
  vision.js           transformers.js pipelines + image prep for isolate/compose
```

---

## Socket.IO Event Protocol

| Direction | Event | Payload | Description |
|---|---|---|---|
| Server → Client | `connected` | — | Handshake confirmation |
| Server → Client | `play` | document + `src: "/media/<key>"` | Instructs client to render this media item |
| Client → Server | `resolve` | — | Playback complete or liked → weight +0.1 |
| Client → Server | `reject` | — | Skipped or disliked → weight −0.1 |
| Client → Server | `run` | command string | Terminal command dispatched server-side |
| Client → Server | `upload` | `{meta: {name, type}, data: "data:...;base64,..."}` | File upload |
| Server → Client | `commands` | `[{name, params, queueable}]` | Action registry, sent on connect |
| Server → Client | `queue:state` | `{jobs, pending, running, tasks}` | Full snapshot, sent on connect |
| Server → Client | `queue:update` | `{job, pending, tasks}` | One job, on every state transition |
| Server → Client | `queue:tasks` | `[task]` | Scheduler heartbeat, every 2s |
| Client → Server | `queue:push` | `{action, params}` → ack `{ok, id}` | Enqueue a job |
| Client → Server | `queue:cancel` | `{id}` | Cancel a job that has not started |
| Client → Server | `list` | `{skip, limit, sort, order, type, search}` → ack `{items, total, …}` | A page of the library, metadata only |
| Client → Server | `playKey` | `{key}` | Force the next item; emit `reject` after to end the current one |
| Server → Client | `run:queued` / `run:done` / `run:error` | — | Reply to a terminal `run` |

The `play` → completion event → next `play` cycle is the core loop. Every client media player must emit `resolve` or `reject` when done.

---

## MongoDB Document Schema

See **Document Model** below — `model/document.js` is the single source of truth.

---

## Tech Stack

- Node.js 24
- Socket.IO 4.6
- MongoDB driver 7.6 with MongoDB 7
- `ffmpeg` — system dependency for crop / normalize / concat actions

---

## Prerequisites

- Node.js ≥ 18 and npm
- MongoDB 7 running locally, **or** Docker
- `ffmpeg`: `sudo apt install ffmpeg` (required for crop, normalize, concat actions)

---

## Installation

```bash
cd zap-api
npm install
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MONGO_URL` | `mongodb://localhost:27017/zap` | MongoDB connection string |
| `PORT` | `3000` | Socket.IO server port |
| `DATA_DIR` | `./data` | Directory scanned by the explore action |
| `MONGO_DB` | from `MONGO_URL` | Database name; overrides the path in the connection string |
| `MODEL_CACHE_DIR` | `./.models` | Where Hugging Face model weights are cached |
| `MODEL_DTYPE` | `fp32` | Model quantization; `q8` is faster but degrades masks badly |
| `INFERENCE_MAX_DIM` | `1024` | Longest edge fed to the model; masks are scaled back up |
| `SEGMENTATION_MODEL` | `Xenova/detr-resnet-50-panoptic` | Segmentation model |
| `MAX_DERIVATION_DEPTH` | `3` | Refuse to compose onto an image this many generations deep |
| `OUTPUT_MAX_DIM` | `2048` | Long-edge cap for generated images |
| `OUTPUT_FORMAT` | `webp` | Encoding for generated images; `png` for lossless |
| `OUTPUT_QUALITY` | `90` | WebP quality (alpha is always kept at 100) |
| `QUEUE_HISTORY` | `50` | Finished jobs kept for the status view |

---

## Running Locally

```bash
# Start MongoDB first
mongod

# Start the API server
npm start
# or with custom env
MONGO_URL=mongodb://localhost:27017/zap npm start
```

The server listens on port 3000. On first run, use the `explore` CLI command to index your media files.

---

## Docker

```bash
npm run docker
# equivalent to: docker compose up --build
```

Starts MongoDB 7 and the API server. Media files are volume-mounted from `./data` into the container.

---

## CLI Invocation

Run a single action then exit (useful for indexing or maintenance):

```bash
node index.js explore     # scan data/ and index all media into MongoDB
node index.js play        # test a single play cycle
node index.js removeAll   # drop all documents from the data collection
```

---

## Available Actions

| Action | Description |
|---|---|
| `explore` | Scans `DATA_DIR`, validates against the document model, upserts into MongoDB. Run this first to populate the library. |
| `play` | Selects a weighted random media document and emits it to the client. |
| `find` | Queries MongoDB for a document by key. |
| `list` | Returns a page of the library as metadata only — no file contents. |
| `update` | Updates the weight field of a document. |
| `record` | Upserts a document (used internally by the upload pipeline). |
| `upload` | Accepts a base64-encoded file over the socket and saves it to `DATA_DIR`. |
| `crop` | Trims a video segment using ffmpeg. |
| `normalize` | Re-encodes a video to H.264/AAC using ffmpeg. |
| `concat` | Concatenates two media files (requires external `mmcat` binary). |
| `removeAll` | Deletes all documents from the MongoDB data collection. |
| `isolate` | Segments an indexed image and saves each cut-out shape as a transparent PNG. |
| `compose` | Mixes a shape isolated from one image into another, saving the composite. |

---

## Document Model

`model/document.js` is the single source of truth for a document in the `data`
collection. Both write paths (`action/explore.js` and `action/record.js`) normalize and
validate against it, so a malformed document is rejected at the boundary rather than
surfacing later as an unplayable item.

| Field | Type | Description |
|---|---|---|
| `key` | string | Unique identifier; currently the file path |
| `source` | string | Path to the file on disk |
| `name` | string | Filename only |
| `type` | string | MIME type, e.g. `"video/mp4"` |
| `weight` | float 0–1 | Relevance score; raised on like, lowered on dislike |

Extra fields are permitted, so a writer can attach its own metadata without every
reader having to know about it. Pass `{ strict: true }` to `validate()` to reject them.

---

## Tests

Built on the Node test runner (`node:test`) — no test dependencies.

```bash
npm test          # unit tests; DB-backed tests are skipped
npm run test:watch
```

Integration tests run only when `MONGO_URL` is set. Point it at a throwaway database —
the name in the URL is respected:

```bash
docker run -d --rm -p 27021:27017 mongo:7
MONGO_URL=mongodb://localhost:27021/zap-test npm test
```

---

## Vision Actions

`isolate` and `compose` build new media from the existing library using
[transformers.js](https://github.com/huggingface/transformers.js) for recognition and
[sharp](https://sharp.pixelplumbing.com/) for the geometry. No Python is involved.

```bash
# Cut the best-scoring shape out of an image
node index.js isolate '{"key":"data/DSCF6442.JPG"}'

# Cut out a specific labelled shape, or every shape found
node index.js isolate '{"key":"data/DSCF6442.JPG","label":"person"}'
node index.js isolate '{"key":"data/DSCF6442.JPG","all":true}'

# Isolate a shape and mix it into another image
node index.js compose '{"from":"data/DSCF6442.JPG","to":"data/photo.jpg","label":"person","scale":0.7,"x":0.25,"y":0.6}'
```

Both are also registered as terminal commands, so the client can run them over the socket.

Generated documents carry `generator`, `derivedFrom`, `label` and `score`, and are linked
to their sources by a `derivative` edge — so they flow into playback through the existing
edge traversal in `action/play.js`. `MAX_DERIVATION_DEPTH` stops generated images being
recomposed indefinitely.

**Model weights** download from the Hugging Face Hub on first use into `MODEL_CACHE_DIR`
(~200 MB, gitignored). In Docker, mount that directory as a volume or the container will
re-download on every start.

**Quality notes**

- `MODEL_DTYPE` defaults to `fp32`. `q8` is faster but was measured to wreck masks on
  this model — a portrait's person mask went from 0.63 to 0.94 coverage, swallowing most
  of the background.
- Compositing is alpha blending, not Poisson blending. There is no `seamlessClone`
  equivalent in sharp, so pasted regions read as pasted. See `TODO.md` item 2.
- Generated images are capped at `OUTPUT_MAX_DIM` and written as WebP. Full-resolution
  lossless PNG was pathological for photographic cutouts: a 16MP person cutout came out
  at 15MB — four times the JPEG it was cut from — because a 93%-coverage mask left
  `trim()` nothing to crop. The same cutout is now 170KB. Measured alternatives: webp q90
  0.64MB uncapped, AVIF smaller again but 26s to encode, which would dominate the queue.

---

## Job Queue

Slow actions run through an in-process FIFO queue instead of blocking the socket
handler, and every state change is broadcast so the client can show live progress.

```
utils/queue.js      FIFO + EventEmitter; the only thing that touches job storage
utils/worker.js     Claims and runs one job per tick
action/registry.js  The one place actions are named; marks which are queueable
cognition.js        The scheduler; runs the drain task every 500ms
```

A job moves `queued → running → done | failed`, or `queued → cancelled`. Jobs carry
`{id, action, params, state, queuedAt, startedAt, finishedAt, error, result}`.

**Concurrency is 1 by design.** The vision actions are CPU-bound ONNX inference, and
running two at once thrashes rather than parallelizes. `Cognition` reschedules a task only
after its previous run settles, so a 20s job cannot be overlapped by the next 500ms tick.

**The queue is in-process and does not survive a restart.** The API runs as a single
process, so atomic multi-worker claims are unnecessary and a lost job costs a button
click. `queue.claim()` is the only thing that touches storage — swapping it for a
`findOneAndUpdate` against a `jobs` collection makes the queue durable without moving
anything else.

`explore` is enqueued rather than run inline, by both the 60s scheduled task and the
client button, so a scheduled scan and a user-triggered one share the queue instead of
racing. The scheduled task skips if an explore is already queued or running.

Which actions are queueable is declared in `action/registry.js`. A terminal `run` of a
queueable action enqueues it and replies `run:queued`; anything else runs inline and
replies `run:done`.

---

## HTTP Media

Playback bytes travel over HTTP, not the socket.

| Route | Description |
|---|---|
| `GET /media/:key` | The file for a library document. `:key` is the document key, URI-encoded. Supports `Range`, `ETag`/`If-None-Match`, and `HEAD`. |
| `GET /health` | Liveness probe. |

`play` now emits `src: "/media/<encoded key>"` instead of a base64 data URL. The client
resolves it against the API origin; players use it as an ordinary `src`.

**Why:** base64-over-socket could not stream or seek, and sent whole files as single
messages. The library's mean payload was 9MB and its largest 95MB. The `play` event is
now ~300 bytes. Video seeking works because the browser can issue range requests.

**Safety:** the path never comes from the URL. The key is looked up in the library and the
stored `source` is used, then checked to be inside `DATA_DIR` — so neither a crafted key
nor a poisoned record can read arbitrary files.

`maxHttpBufferSize` stays at 500MB because uploads still arrive as base64 over the socket.

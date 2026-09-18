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
| Client → Server | `list` | `{skip, limit, sort, order, type, search}` → ack `{items, total, …}` | A page of the library, metadata only. Sort by `name`, `type`, `weight`, `key` or `date`. |
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
| `MODEL_IDLE_MS` | `90000` | Release the loaded model after this long unused |
| `INFERENCE_MAX_DIM` | `1024` | Longest edge fed to the model; masks are scaled back up |
| `SEGMENTATION_MODEL` | `Xenova/detr-resnet-50-panoptic` | Segmentation model |
| `MAX_DERIVATION_DEPTH` | `3` | Refuse to compose onto an image this many generations deep |
| `RENDER_MAX_DIM` | `1280` | Long edge of a rendered video |
| `RENDER_STILL_FPS` | `12` | Frame rate when rendering a still; it never changes, so this only costs size |
| `RENDER_PRESET` | `veryfast` | x264 preset; `veryfast` runs ~2.4x realtime at 1080p on this machine |
| `EFFECT_MAX_DIM` | `1280` | Long edge of an effect's output |
| `EFFECT_STILL_SECONDS` | `6` | Default length when animating a still |
| `MONTAGE_WIDTH` / `MONTAGE_HEIGHT` | `1280` / `720` | Montage frame size |
| `MONTAGE_FPS` | `25` | Montage frame rate |
| `MONTAGE_STILL_SECONDS` | `3` | Seconds per still in a montage |
| `MONTAGE_MAX_ITEMS` | `12` | Cap on items joined in one montage |
| `TTS_MODEL` | `Xenova/mms-tts-eng` | Speech model; the MMS family covers many languages (`-fra`, `-deu`, …) |
| `TTS_CHUNK_CHARS` | `300` | Longest text synthesised in one pass |
| `TTS_MAX_CHARS` | `5000` | Text beyond this is truncated |
| `TTS_BITRATE` | `128k` | mp3 bitrate for narration |
| `OUTPUT_MAX_DIM` | `2048` | Long-edge cap for generated images |
| `OUTPUT_FORMAT` | `webp` | Encoding for generated images; `png` for lossless |
| `OUTPUT_QUALITY` | `90` | WebP quality (alpha is always kept at 100) |
| `QUEUE_HISTORY` | `50` | Finished jobs kept for the status view |
| `QUEUE_INTERVAL_MS` | `5000` | How often an idle queue is checked; a backlog is not paced by this |
| `RECENCY_HALF_LIFE_DAYS` | `1` | Days for a document's recency contribution to halve |
| `RECENCY_FLOOR` | `0.1` | Lowest recency multiplier, so old media stays reachable |
| `RECENCY_STRENGTH` | `1` | 0 selects on weight alone, ignoring age |
| `TRAVERSAL_PROBABILITY` | `0.6` | How often playback follows an edge rather than drawing from the whole library |
| `DATA_BUDGET_MB` | `1024` | Bytes of machine-owned media to keep; uploads are never counted |
| `INGEST_PER_FEED` | `5` | Items taken from each feed per poll |
| `INGEST_MAX_CHARS` | `600` | Cap on the text kept per item |
| `FEED_MIN_INTERVAL_MS` | `900000` | Shortest gap between feed polls |
| `FEED_USER_AGENT` | `zap/1.0 …` | Sent when fetching feeds |
| `SUMMARY_MODEL` | `Xenova/distilbart-cnn-6-6` | Summarisation model |
| `SUMMARY_MAX_TOKENS` | `44` | Roughly a sentence or two |
| `SUMMARY_MIN_INPUT` | `120` | Below this, nothing is condensed |
| `EDGE_PRUNE_THRESHOLD` | `0.1` | Weight below which an associative edge is dropped |
| `GENERATE_ENABLED` | `true` | Unattended generation; `false` disables it |
| `GENERATE_INTERVAL_MS` | `30000` | How often it looks for something to do |
| `GENERATE_MAX_DOCS` | `200` | Ceiling on generated documents |

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
| `subscribe` | Add, remove or list syndication feeds. |
| `ingest` | Pull items from subscribed feeds into the library as text documents. |
| `summarize` | Condense a text document with a small language model, keeping the original. |
| `play` | Selects a weighted random media document and emits it to the client. |
| `find` | Queries MongoDB for a document by key. |
| `list` | Returns a page of the library as metadata only — no file contents. |
| `help` | Lists every action and its arguments; `help <action>` details one. |
| `update` | Updates the weight field of a document. |
| `record` | Upserts a document (used internally by the upload pipeline). |
| `upload` | Accepts a base64-encoded file over the socket and saves it to `DATA_DIR`. |
| `crop` | Trims a video segment using ffmpeg. |
| `normalize` | Re-encodes a video to H.264/AAC using ffmpeg. |
| `concat` | Concatenates two media files (requires external `mmcat` binary). |
| `prune` | Repairs the library and enforces the generated-media budget. `dryRun` reports without deleting. |
| `removeAll` | Deletes all documents from the MongoDB data collection. |
| `isolate` | Segments an indexed image and saves each cut-out shape as a transparent PNG. |
| `compose` | Mixes a shape isolated from one image into another, saving the composite. |
| `render` | Builds a new video from a visual and an audio track — a still, a clip, or a text document rendered as a frame. |
| `effect` | ffmpeg effect on a clip, or motion from a still: speed, reverse, fade, colour, greyscale, rotate, zoom, zoomout, pan, kenburns. |
| `adjust` | Still-to-still image adjustments: blur, sharpen, greyscale, negate, colour, tint, gamma, posterize, bloom, flip, flop, rotate, square. |
| `montage` | Joins several items into one video, optionally scored with a track in the same pass. |
| `speak` | Reads a text document aloud, storing the narration as audio and linking it as a soundtrack. |

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

`QUEUE_INTERVAL_MS` governs how often an **idle** queue is checked. The worker keeps
running while jobs remain, so a backlog is not paced by it — taking one job per tick would
insert that interval between every job.

**Inference runs out of process.** `isolate`, `compose` and `speak` are marked
`subprocess` in the registry and run via `scripts/run-action.mjs`. ONNX inference is
CPU-bound and synchronous, so in the API process it blocked the event loop — a trivial
request went from 5ms to over 7 seconds — and playback stalled for as long as a job ran.
Out of process it cannot, and the child exiting also returns the model's memory: the API
sits at ~186MB instead of holding 4.3GB.

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

---

## Rendering video from a visual and a track

`render` builds a new video in the library:

```bash
# a still held for the length of a track
node index.js render '{"visual":"data/photo.jpg","audio":"data/track.mp3"}'

# a clip with its audio replaced
node index.js render '{"visual":"data/clip.mp4","audio":"data/track.mp3"}'

# omit `audio` and a soundtrack edge is used, so a pairing made with connect renders
node index.js connect '{"from":"data/photo.jpg","to":"data/track.mp3","type":"soundtrack"}'
node index.js render  '{"visual":"data/photo.jpg"}'
```

A text document is rasterised to a frame first, sized to fill it: short strings render
very large, long ones wrap and step down. The frame is written to a temp directory rather
than `DATA_DIR`, because `explore` scans that on a timer and would index the intermediate.

Transparent cutouts are flattened onto `background` (default black) — video has no
alpha channel. Output is capped at `RENDER_MAX_DIM` and padded to even dimensions, which
`yuv420p` requires.

Duration comes from probing the inputs and cutting at the shorter of the two, not from
`-shortest`: that overshot by up to 2.4s on a 6s track, leaving a frozen frame over
silence.

---

## Effects and montage

The three video actions compose, each doing one thing:

```bash
# animate a still — the movement a rendered still otherwise lacks
node index.js effect '{"key":"data/photo.jpg","effect":"zoom","seconds":4}'
node index.js effect '{"key":"data/photo.jpg","effect":"pan","direction":"left"}'

# manipulate a clip
node index.js effect '{"key":"data/clip.mp4","effect":"speed","factor":2}'
node index.js effect '{"key":"data/clip.mp4","effect":"reverse"}'
node index.js effect '{"key":"data/clip.mp4","effect":"colour","saturation":2.2,"contrast":1.3}'

# adjust a still, staying a still — so the result can be isolated, composed or joined
node index.js adjust '{"key":"data/photo.jpg","adjust":"posterize","levels":5}'
node index.js adjust '{"key":"data/photo.jpg","adjust":"tint","colour":"#3355ff"}'

# join items, either explicitly or by following the edge graph
node index.js montage '{"keys":["data/a.jpg","data/b.mp4","data/c.jpg"],"seconds":2}'
node index.js montage '{"from":"data/a.jpg","count":5}'

# a series of images with a soundtrack, in one pass
node index.js montage '{"keys":["data/a.jpg","data/b.jpg","data/c.jpg"],"seconds":3,"audio":"data/track.mp3"}'

# or score an existing video
node index.js render '{"visual":"data/montage-20260101120000.mp4","audio":"data/track.mp3"}'
```

`adjust` differs from `effect` in what it produces: `effect` always yields video, turning a
still into motion, while `adjust` keeps an image an image so it can be fed back into
`isolate`, `compose`, `montage` or `render`.

`montage` uses the concat **filter**, not the demuxer. The demuxer requires every input to
share codec, resolution and frame rate, which would mean normalizing each source first;
the filter scales, pads and re-rates each input in one pass, so mismatched sources join
directly. Stills are looped for `seconds` each.

The edge-walk form gathers items breadth-first from `from`, following the same graph
playback traverses, skipping `soundtrack` edges since audio has no frames.

---

## Text to speech

```bash
node index.js speak '{"key":"data/note.txt"}'

# then turn the text and its narration into a video — the soundtrack edge is followed
node index.js render '{"visual":"data/note.txt"}'
```

Synthesis runs through transformers.js, so it needs no system dependency beyond the
ffmpeg already required — raw float samples are piped straight into ffmpeg rather than
staging a WAV. The model is MMS-TTS, a VITS model needing no speaker embeddings, unlike
SpeechT5.

Text longer than `TTS_CHUNK_CHARS` is split on sentence boundaries (falling back to words
for a single long sentence) and the pieces joined with a short gap.

As well as the usual `derivative` edge, `speak` links a `soundtrack` edge from the text to
its narration, so the text is read aloud when it comes up in playback. Pass
`narrate: false` to skip that and leave the audio standalone.

---

## Unattended generation

The `generate` cognition task keeps the library growing on its own. Every 30 seconds, if
nothing is in flight, it picks a transformation that applies to the media on hand and
queues it with random inputs:

| | |
|---|---|
| a soundtrack pairing not yet rendered | `render` — deliberate pairings come first |
| text with no narration | `speak` |
| a still or clip plus a random track | `render` |
| a clip | `effect` — speed, reverse, greyscale, colour, fade |
| a still | `effect` zoom or pan, or `isolate` |
| several items | `montage` |

Safeguards, because it writes files and shares one queue slot with everything else:

- **acts only when the queue is completely idle** — nothing queued *or* running. Jobs run
  for seconds to minutes, so anything added while work is in flight would stack up behind
  it and starve whatever was triggered by hand.
- **never uses a generated document as input.** A transformation's output is itself
  transformable, so feeding results back in compounds without bound.
- stops at `GENERATE_MAX_DOCS`.
- remembers what failed and does not retry it, rather than reattempting a broken file
  every 30 seconds.

It replaces the earlier `weave` task, whose job — rendering linked soundtrack pairs — is
now the first strategy above. Two tasks feeding one concurrency-1 queue would only have
taken turns.

Run `help` in the terminal to see every action and its arguments.

---

## Memory

Inference is the memory ceiling for the whole service. A loaded fp32 segmentation
pipeline holds about **4.3GB**, and onnxruntime does not give that back when the job
finishes — the arena stays allocated for as long as the pipeline is cached.

`utils/models.js` therefore keeps **one** pipeline resident at a time and releases it once
idle (`MODEL_IDLE_MS`). Loading a second model evicts the first. Before that, caching
segmentation and text-to-speech together exceeded the container's memory and the kernel
killed the process mid-job; steady state is now ~665MB with peaks around 4.3GB.

Reloading a model costs a few seconds. The queue runs one job at a time with gaps between
them, so that is a far better trade than dying.

`docker-compose.yml` sets `mem_limit: 5g` so a runaway load fails one container rather
than the whole Docker VM, and `restart: unless-stopped` so it comes back rather than
staying down. Check `docker inspect <container> --format '{{.State.OOMKilled}}'` if the
API disappears.

---

## Choosing what plays next

Selection is proportional to **weight × recency**, so a liked item comes up more often
than a disliked one and a recent item more often than an old one.

The draw uses the Efraimidis–Spirakis trick — give each candidate a key of
`random ^ (1 / score)` and take the largest — which selects in proportion to score in a
single pass. `$sample` cannot: it is uniform, so before this weight only decided whether a
document *qualified*, never how often it actually came up.

Age comes from the ObjectId, which encodes its creation time, so nothing had to be stored
or migrated.

Two details make it work in practice, both found by measuring rather than reasoning:

- **The decay is floored** (`RECENCY_FLOOR`). Unfloored, a one-day half-life makes a
  month-old item 2⁻³⁰ as likely as a fresh one — never. Floored, it is simply a tenth as
  likely, so the library stays fully reachable however old it gets.
- **The graph walk yields sometimes** (`TRAVERSAL_PROBABILITY`). `relate` has been adding
  edges since the library began, so older documents accumulate far more of them and new
  ones are rarely among a traversal's candidates. Weighting the draw *within* a candidate
  set could not fix that — measured, traversal alone left the newest quarter at a twelfth
  of plays. Skipping traversal some of the time lets the library-wide draw reach
  everything.

Measured on a 100-document library: the newer half takes about two thirds of plays, with
28 distinct items across 35 plays — the bias is clear without collapsing variety.

---

## Data limit

`prune` runs every two minutes and does two separate jobs.

**Repair**, unconditionally: documents whose file has gone, documents that no longer
satisfy the model, and edges pointing at documents that do not exist. Each of those stalls
playback if selected, so they go regardless of any budget.

**Budget**: if generated media exceeds `DATA_BUDGET_MB`, the lowest-scoring is deleted
first — by the same `weight × recency` score playback uses, so what goes is what you
engage with least, oldest first.

**Uploads are never counted and never deleted.** The budget governs only what the machine
made. Anything without a `generator` field is untouchable, so nothing you put in can be
lost to it.

Provenance edges (`derivative`, `soundtrack`, `sequence`) are never pruned by weight.
They record where something came from, which is not an opinion to be voted away.

```bash
node index.js prune '{"dryRun":true}'              # report without deleting
node index.js prune '{"dryRun":true,"budgetMb":30}' # try a tighter budget first
```

Measured when this was written: 544MB of uploads, 64MB of generated media, growing about
52MB a day at the default generation rate — so the 1GB default is roughly three weeks of
output before anything is evicted.

---

## Feeds

```bash
node index.js subscribe '{"url":"https://feeds.bbci.co.uk/news/rss.xml"}'
node index.js subscribe '{"list":true}'
node index.js ingest '{"limit":3}'
```

Items become ordinary text documents, so everything downstream already works: the text
player shows them, `speak` narrates them, and `render` turns headline plus narration into
a video. None of that needed code specific to feeds.

`ingest` is one of the strategies `generate` chooses from rather than having its own
scheduler, so feeds are polled as part of the same queue as everything else — no more
often than `FEED_MIN_INTERVAL_MS`, since feeds change on the order of minutes and polling
harder is merely rude.

**Only what a feed publishes for syndication is used** — headline, summary and link — and
every document carries `sourceUrl` and `attribution`, so provenance travels with it.

**Images are not fetched.** A feed offering an enclosure invites a reader to display it;
downloading press photography and compositing it into generated videos is a different
thing. The parser reads the image URL and `ingest` deliberately ignores it.

Fetched documents are marked `origin`, which makes them machine-owned: `prune` may evict
them under the data budget, the same as generated media. Uploads remain untouchable.

---

## Summarising feed text

```bash
node index.js summarize '{"key":"data/rss-a8ee96a9d046.txt"}'
```

Feed items arrive padded, and the text player renders whatever it is given very large, so
the padding crowds out the headline. A Hacker News item carrying
`Article URL … Comments URL … Points: 165 # Comments: 46` condenses to just its headline.

The original is kept on the document as `summarizedFrom`, so nothing is lost.

`generate` offers this for any feed text not yet condensed, and it runs out of process
like the other inference. The model is roughly 300MB against the segmentation model's
4.3GB, and fp32 for the same reason: q8 halves the memory and produces garbage —
*"Korea raises data breach fines to 10% of revenue to 10%. Korea raisesData breach fines."*

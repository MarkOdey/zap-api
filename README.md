# zap-api

Backend engine for the Zap multimedia player. Manages a media library (video, image, text) stored in MongoDB, extracts metadata via `exiftool`, and communicates with the browser client exclusively over Socket.IO. There are no REST routes — the entire protocol is WebSocket-based.

The server runs a continuous loop: it selects the next most relevant media item using a weighted algorithm, pushes it to the connected client, waits for a completion signal (liked / finished / skipped), adjusts the item's weight accordingly, and repeats.

---

## Architecture

```
index.js              Entry point — registers actions, runs CLI invocation, bootstraps Cognition
session.js            Socket.IO server (port 3000); per-connection Session lifecycle and action queue
cognition.js          Background decision layer (stub)
action/
  play.js             Weighted random MongoDB query → emits 'play' event to client
  explore.js          Scans data/ dir, runs exiftool, upserts metadata into MongoDB
  find.js             Queries MongoDB by key
  update.js           Adjusts weight field on a document
  record.js           Upserts a document (used by upload pipeline)
  upload.js           Accepts base64-encoded file over socket, saves to data/
  crop.js             Trims a video segment via ffmpeg
  normalize.js        Re-encodes video to H.264/AAC via ffmpeg
  concat.js           Concatenates two media files via external binary
  removeAll.js        Drops all documents from data collection
media/
  file.js             Base class: exif metadata extraction, DB record
  image.js            Image media type
  video.js            Video media type — runs normalize on upload
relation/
  anything.js         Delegates to Find, emits resolve with result
utils/
  MongoConnexion.js   Singleton MongoDB client (reads MONGO_URL env var)
```

---

## Socket.IO Event Protocol

| Direction | Event | Payload | Description |
|---|---|---|---|
| Server → Client | `connected` | — | Handshake confirmation |
| Server → Client | `play` | MongoDB document | Instructs client to render this media item |
| Client → Server | `resolve` | — | Playback complete or liked → weight +0.1 |
| Client → Server | `reject` | — | Skipped or disliked → weight −0.1 |
| Client → Server | `run` | command string | Terminal command dispatched server-side |
| Client → Server | `upload` | `{meta: {name, type}, data: "data:...;base64,..."}` | File upload |

The `play` → completion event → next `play` cycle is the core loop. Every client media player must emit `resolve` or `reject` when done.

---

## MongoDB Document Schema

Fields set by `exiftool` during `explore`:

| Field | Type | Description |
|---|---|---|
| `SourceFile` | string | Absolute path to the file on disk |
| `SourceUrl` | string | Relative URL path for serving the file |
| `FileType` | string | e.g. `"MP4"`, `"JPEG"`, `"PNG"` |
| `MIMEType` | string | e.g. `"video/mp4"`, `"image/jpeg"` |
| `ImageWidth` | number | Width in pixels |
| `ImageHeight` | number | Height in pixels |
| `FileName` | string | Filename only |
| `Duration` | number | Duration in seconds (video) |

Fields managed by Zap:

| Field | Type | Description |
|---|---|---|
| `weight` | float 0–1 | Relevance score; increases on resolve, decreases on reject |
| `key` | string | Unique identifier within the library |

---

## Tech Stack

- Node.js 24
- Express 4.17 (static file serving only, no routes)
- Socket.IO 2.3.0
- MongoDB driver 3.3.5 with MongoDB 7
- `exiftool` — system dependency for metadata extraction
- `ffmpeg` — system dependency for crop / normalize / concat actions

---

## Prerequisites

- Node.js ≥ 18 and npm
- MongoDB 7 running locally, **or** Docker
- `exiftool`: `sudo apt install libimage-exiftool-perl`
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
| `explore` | Scans `DATA_DIR`, extracts metadata via exiftool, upserts into MongoDB. Run this first to populate the library. |
| `play` | Selects a weighted random media document and emits it to the client. |
| `find` | Queries MongoDB for a document by key. |
| `update` | Updates the weight field of a document. |
| `record` | Upserts a document (used internally by the upload pipeline). |
| `upload` | Accepts a base64-encoded file over the socket and saves it to `DATA_DIR`. |
| `crop` | Trims a video segment using ffmpeg. |
| `normalize` | Re-encodes a video to H.264/AAC using ffmpeg. |
| `concat` | Concatenates two media files (requires external `mmcat` binary). |
| `removeAll` | Deletes all documents from the MongoDB data collection. |

# Implementation plan: streaming & agent-built prompts

Status: **approved-decisions, implementation not started.** Execution mode:
**plan only — wait for explicit go-ahead before writing code** (per sign-off).

Companion documents:
- Design (engine): `docs/design/streaming-and-prompts.md`
- Design (client): `zap-cli/docs/design/streaming-and-prompts.md`
- Client task plan: `zap-cli/docs/plan/streaming-and-prompts.md`

## Resolved decisions this plan encodes

1. **Audio:** broadcast airs **only videos that already have an audio track**;
   silent clips excluded (no synthetic audio).
2. **HLS preview:** built alongside RTMP (`/broadcast/live.m3u8`).
3. **Mission surfacing:** both — quiet panel always + opt-in "nudge" toast.
4. **Weights:** broadcast does not mutate weights by default.
5. **Answer analysis:** pre-tag answers from mission terms immediately **and**
   queue `analyse` for image/video answers.

## Conventions

- Branch (both repos): `claude/streaming-agent-prompts-edy4hq`.
- Tests use the repo's runner (`node --test "test/**/*.test.js"`). Every new pure
  module ships with a test; ffmpeg/RTMP/ONNX boundaries are exercised through an
  injectable spawn/probe seam so tests need no external binaries or network.
- Each phase is one reviewable unit. Do not start a phase before the previous is
  approved.

---

## Phase 0 — Selection & metadata groundwork (engine)

Small, low-risk, unblocks Phase 1. No user-visible change.

- [ ] **`utils/selection.js`** — add an optional `match` object to
  `selectionPipeline({ ... })`, merged into the existing `$match` (keeps `weight`
  threshold and `keys`). `traversalPipeline` / `fallbackPipeline` pass it through.
  Backwards compatible: no `match` ⇒ today's behaviour.
- [ ] **`utils/ffprobe.js`** — confirm `probeStreams` returns per-stream
  `codec_type`; add a helper `describeMedia(source) -> { hasAudio, duration,
  width, height }` if not already derivable.
- [ ] **`action/explore.js`** — when indexing/updating a `video/*` document,
  populate `hasAudio` (+ `duration`, `width`, `height`) via `describeMedia`.
  Probe lazily: only when the field is missing or the file's mtime changed, so
  re-explore stays cheap.
- [ ] **`model/document.js`** — document the new optional fields (`hasAudio`,
  `duration`, `width`, `height`) in `FIELDS`.
- [ ] **Backfill note** — existing video docs have no `hasAudio`; the broadcast's
  on-air ffprobe safety net (Phase 1) covers them until a re-explore fills the
  field. Optionally a one-off `node index.js explore` pass.

**Tests:** `test/selection.test.js` (extend) — `match` filter narrows the draw;
absent `match` unchanged. `test/ffprobe`/`test/explore` — `describeMedia` shape
and that explore records `hasAudio` (probe seam mocked).

**Acceptance:** `selectionPipeline({ match: { type: /^video\//, hasAudio: true }})`
returns only audio-bearing videos; all existing selection tests still pass.

---

## Phase 1 — Live RTMP broadcast + HLS preview (engine)

The core of feature 1. Depends on Phase 0.

- [ ] **`utils/broadcast.js`** (new) — the pipeline, with an injectable spawn seam:
  - Persistent **encoder** ffmpeg: `-f mpegts -i pipe:0 -c:v libx264 -preset
    veryfast -g <2*fps> -c:a aac -f flv <RTMP_URL>`, plus `-fflags +genpts`.
  - Per-clip **normaliser**: transcode selected clip → canonical MPEG-TS
    (`BROADCAST_WIDTH×HEIGHT`, `FPS`, H.264/AAC, SAR 1:1, scale+pad to fit).
    Reuse the ffmpeg-arg patterns from `action/normalize.js` / `action/effect.js`.
  - **Playout buffer**: pre-normalise the next clip while the current airs; write
    ready segments into the encoder's stdin in order.
  - **Filler loop**: a pre-generated black/"up next" TS looped when selection is
    empty or normalisation lags, so the encoder never starves.
  - **HLS window**: also write a rolling `.m3u8` + last-N segments to a temp dir
    for the preview (same canonical TS).
  - **On-air audio guard**: ffprobe each clip before airing; skip if no audio
    (safety net over `hasAudio`).
  - Lifecycle: `start({url})`, `stop()`, `status()`; single active broadcast.
- [ ] **`action/broadcast.js`** (new) — control action, params `{ op:
  'start'|'stop'|'status', url?, key? }`. Masks the stream key in all returns/logs.
- [ ] **`action/registry.js`** — register `broadcast` (not queueable; owns a
  long-lived process).
- [ ] **`utils/mediaRoute.js` (or new `utils/broadcastRoute.js`)** — mount
  `GET /broadcast/live.m3u8` and `GET /broadcast/seg-*.ts` (served from the temp
  HLS dir, path-guarded like the media route) and `GET /broadcast/status`.
- [ ] **`session.js`** — dispatch `broadcast` control; emit `broadcast:state`
  `{ live, uptime, currentKey, target(masked), segmentsAhead, lastError }` on
  transitions + on the existing 2s heartbeat.
- [ ] **Env & docs** — `RTMP_URL` / `RTMP_INGEST` + `RTMP_KEY`,
  `BROADCAST_WIDTH|HEIGHT|FPS|BITRATE`, `BROADCAST_RESOLVE_ON_PLAY` (default off).
  Document in `README.md`. Confirm the Debian ffmpeg build has `libx264`
  (`ffmpeg -codecs | grep 264`); note in README if a package bump is needed.

**Tests:** `test/broadcast.test.js` — video+audio-only selection filter; playout
next-segment vs filler decision; stream-key masking; lifecycle state machine;
HLS playlist rolls to last N. ffmpeg spawn is mocked via the seam.

**Acceptance (manual, documented in README):** with `RTMP_URL` set to a local
RTMP sink, `broadcast start` produces a continuous stream of audio-bearing videos
with no drop between clips; `/broadcast/live.m3u8` plays the same feed;
`broadcast stop` tears down cleanly; a library with no audio-bearing video shows
the filler rather than crashing.

---

## Phase 2 — Broadcast client surface (zap-cli)

Depends on Phase 1. Detailed in the zap-cli plan; summary here:

- [ ] `useSession.js` — `broadcast:state` handler → `broadcastState` ref; verbs
  `startBroadcast` / `stopBroadcast`.
- [ ] `components/BroadcastPanel.vue` — LIVE indicator, current clip, masked
  target, `segmentsAhead`, errors, Start/Stop, and the HLS `<video>` monitor
  (native HLS + `hls.js` fallback).
- [ ] `App.vue` — mount panel + left-column control button.

**Acceptance:** operator can start/stop the broadcast and watch the live HLS
monitor from the browser; key is never exposed client-side.

---

## Phase 3 — Mission model, vocabulary & generator (engine)

The core of feature 2. Independent of Phases 0–2.

- [ ] **`model/mission.js`** (new) — schema + `validate` / `normalize`
  (`key, kind, prompt, terms[], accepts[], origin, template, status, responses[],
  createdAt, answeredAt`). Missions live in a `missions` collection (never in
  playback).
- [ ] **`utils/vocabulary.js`** (new) — build a weighted term list from `data`:
  `subjects`/`labels` (coverage + frequency) and optional feed-text keywords;
  each term carries frequency and **graph-density** (docs/edges referencing it).
- [ ] **`missions/generator.js`** (new) — `MissionGenerator` interface
  `generate(vocabulary, options) -> mission`; `TemplateGenerator` selected by
  default. Seam for a future `origin:'llm'` behind `MISSION_GENERATOR`.
- [ ] **`missions/templates.js`** (new) — data-driven templates (kind, accepts,
  arity, term-selection strategy: frequent/rare/co-occurring/random). Seed set:
  one-term find, pair create, text memory, contrast. Bias toward **sparse** terms.
- [ ] **`cognition/prompt.js`** (new) + **`index.js`** — scheduled task: when open
  missions < cap, generate one. Register alongside `relate`/`generate`.
- [ ] **`action/mission.js`** (new) + registry — `{ op: 'list'|'get'|'generate'
  |'dismiss', ... }`.

**Tests:** `test/vocabulary.test.js` (weighting/sparsity), `test/mission.test.js`
(model + template rendering + generator determinism on a seeded vocabulary).

**Acceptance:** `mission generate` yields a well-formed open mission whose terms
come from the library; the cognition task keeps a small pool of open missions.

---

## Phase 4 — Answering missions & closing the lexical loop (engine)

Depends on Phase 3.

- [ ] **`action/respond.js`** (new) + registry — `{ missionKey, text? | upload? }`:
  1. Ingest answer into `data` (reuse `action/upload.js` for image/video, a text
     write like `action/ingest.js` for text); set `origin:'mission'`, `missionKey`.
  2. **Pre-seed `labels`/`subjects`** from the mission's terms (immediate
     linkability).
  3. For image/video answers, **queue `analyse`** to confirm/augment (decision 5).
  4. **Create edges** to existing docs sharing those terms via `action/connect.js`
     (`SUBJECT`/`THEME`).
  5. Mark mission `answered`; record response key(s).
- [ ] **`session.js`** — emit `mission:state` (current open mission) on the
  heartbeat; handle `mission:answer` → `respond`.
- [ ] **Term-biased fetch** (close the loop) — extend `cognition/generate.js` /
  `action/ingest.js` so that when open missions exist, feed ingest and
  analyse/relate work are prioritised by mission terms. External `discover` action
  remains **out of scope** (needs an approved media API + network).

**Tests:** `test/respond.test.js` — ingest + pre-tag + `analyse` enqueued + edges
created + mission closed; term-biased strategy prefers mission terms.

**Acceptance:** answering a mission produces a document that is immediately
reachable by traversal from library items sharing the term, and the mission moves
to `answered`.

---

## Phase 5 — Mission client surface (zap-cli)

Depends on Phases 3–4. Detailed in the zap-cli plan; summary:

- [ ] `stores/mission.js`, `useSession.js` (`mission:state` + `answerMission`),
  `components/MissionPanel.vue` (quiet panel + accepts-based answer affordance +
  opt-in "nudge" toast persisted in `localStorage`), `App.vue` mount + button.

**Acceptance:** an open mission shows in the panel; text/image/video answers
submit and clear the mission; the nudge toggle controls occasional surfacing and
never blocks playback.

---

## Sequencing & dependencies

```
Phase 0 ─▶ Phase 1 ─▶ Phase 2        (streaming track)
Phase 3 ─▶ Phase 4 ─▶ Phase 5        (missions track)
```

The two tracks are independent and could proceed in parallel, but per the
"phase by phase" preference the recommended serial order is **0 → 1 → 2 → 3 → 4 →
5**, streaming first (most self-contained, reuses the loop directly).

## Remaining minor questions (safe defaults chosen; flag to change)

1. **`hasAudio` backfill** — rely on lazy re-explore + on-air ffprobe guard
   (default), or run a one-off full re-explore before first broadcast?
2. **Canonical output size** — default 1280×720 @ 30fps, ~4500 kbps. Confirm or
   set for your channel.
3. **Mission cap & cadence** — default: keep ≤3 open missions, generate at most
   one per cognition tick. Confirm.
4. **Text-answer storage** — store as a `text/plain` file under `DATA_DIR` like
   RSS ingest (default), consistent with the one-file-one-document model.

None of these block starting Phase 0; they can be settled as each phase lands.

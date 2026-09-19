# Design: Live streaming & agent-built prompts

Status: **proposal, awaiting sign-off** · No code has been written yet.
Scope: two features spanning `zap-api` (engine) and `zap-cli` (Vue client).
This is the authoritative document; `zap-cli/docs/design/streaming-and-prompts.md`
covers the client surface in more detail and refers back here.

Decisions already taken (from the request):

- **Streaming target:** generic RTMP, YouTube-ready — a configurable ingest URL +
  stream key, so the same feature works with YouTube Live, Twitch, or any RTMP
  sink. No YouTube-specific OAuth/Live API wiring.
- **Prompt engine:** local / template, built from the library's own lexical terms
  (`labels` / `subjects` from `analyse`, feed text). No external LLM dependency,
  in keeping with the existing local-model design (segmenter, kokoro TTS,
  distilbart summariser). A pluggable seam is left so an LLM backend could be
  dropped in later, but nothing in this pass requires one.

---

## 0. How this fits the existing engine

Both features are extensions of one mechanism that already exists, not new
subsystems bolted on:

- **The selection loop.** `action/play.js` selects the next document with
  `selectionPipeline` / `traversalPipeline` (`utils/selection.js`) — a draw
  proportional to `weight × recency`, with edge-following for continuity — emits
  it to a socket, then parks on a `resolve` / `reject` promise. The only thing
  binding that loop to a browser is `session.socket`.
- **The lexical layer.** `action/analyse.js` tags images with `labels` /
  `subjects`; `cognition/relate.js` draws `SUBJECT` / `THEME` edges between
  documents that share a subject; `action/ingest.js` + `action/subscribe.js` pull
  external RSS text; `action/summarize.js` condenses it. Playback walks those
  edges. This is the substrate the prompts feature grows on.

Feature 1 reuses the **selection loop** with a non-browser sink. Feature 2 grows
the **lexical layer** with a human in the loop.

---

## 1. Live streaming (video-only RTMP feed)

### 1.1 Goal

Broadcast a continuous, video-only feed to an RTMP endpoint, choosing clips with
the same relevance mechanism the player uses. A viewer on YouTube (or any RTMP
consumer) sees an unbroken program of the library's videos, sequenced the way the
player would sequence them.

### 1.2 The hard part: continuity

RTMP live ingest expects **one uninterrupted stream** at a steady frame rate and
bitrate, with regular keyframes (YouTube asks for a 2–4 s keyframe interval). Two
constraints follow:

1. **The encoder must never exit between clips.** If ffmpeg terminates when a clip
   ends, the RTMP connection drops and YouTube ends or stalls the broadcast.
   So a *relaunch-ffmpeg-per-clip* design is out.
2. **Clips are heterogeneous.** The library's videos differ in resolution, frame
   rate, codec, pixel aspect ratio, and audio layout (some have none). They can't
   be concatenated raw.

### 1.3 Chosen architecture: normalize-to-TS + one persistent encoder

Two roles, connected by a pipe:

```
selection loop ──picks video──▶ normaliser ──canonical .ts──▶ playout ──pipe──▶ encoder ──▶ RTMP
  (utils/selection.js,          (short-lived ffmpeg           (buffer +      (one long-lived
   video-only)                   per clip → MPEG-TS)           filler)        ffmpeg, holds RTMP)
```

- **Normaliser.** For each selected clip, a short-lived ffmpeg transcodes it to a
  **canonical MPEG-TS segment**: fixed resolution (default 1280×720), fixed fps
  (default 30), H.264 + AAC, fixed GOP, `SAR 1:1`, letter/pillar-boxed to fit.
  MPEG-TS is chosen because TS segments with identical stream parameters can be
  **byte-concatenated** into one continuous stream — this is the standard trick
  behind HLS and TS playout. Reuses the ffmpeg patterns already in `action/
  normalize.js` and `action/effect.js`.
- **Playout.** Maintains a small buffer of ready segments and writes them, in
  order, into the encoder's stdin. It pre-normalises the *next* clip while the
  current one is on air, so a segment is ready before it's needed.
- **Encoder.** One persistent ffmpeg: `-f mpegts -i pipe:0 … -c:v libx264
  -c:a aac -f flv rtmp://…`. It holds the RTMP connection for the whole
  broadcast and re-stamps timestamps continuous across segment boundaries
  (`-fflags +genpts`, TS discontinuity handling).
- **Filler (starvation guard).** If selection returns nothing, or normalisation
  falls behind, the playout feeds a pre-generated **idle loop** (a black frame /
  "up next" card as a short looping TS) so the encoder never runs dry and the
  broadcast never drops. Generated once at broadcast start.

> **"Only video" and the silent-audio caveat.** The request is a video-only feed,
> but YouTube Live (and most RTMP sinks) expect *an* audio track and may reject a
> video-only stream. The canonical segment therefore carries a **silent AAC
> track** unless the source clip has audio. This keeps the feed effectively
> video-only while remaining a valid live stream. Configurable
> (`BROADCAST_SILENT_AUDIO=true` default).

**Fallback noted, not chosen:** a self-hosted HLS output (API writes an `.m3u8`
+ segments, served over `/broadcast/live.m3u8`) is simpler and has no external
dependency, but it isn't "on YouTube." It's worth keeping as an *internal
preview/monitor* of what's being broadcast, and the normalise-to-TS design makes
it nearly free to add later (the segments already exist). Out of scope for this
pass unless wanted.

### 1.4 Reuse of the player mechanism

- **Selection.** Extend `selectionPipeline` (`utils/selection.js`) with an
  optional **type filter** so a draw can be restricted to `video/*`. Today the
  `$match` keys on `weight` and an optional `keys` list; add an optional
  `typePattern` (e.g. `/^video\//`) merged into the same `$match`. Traversal
  restricts edge-target candidates to video documents the same way.
- **The "session" shape.** Introduce a `BroadcastSession` mirroring the `Session`
  loop in `session.js`, but `advance()` is driven by **clip completion in the
  playout** rather than a socket `resolve` / `reject`. No viewer, so no
  appreciation signal.
- **Weights.** A broadcast has no human like/dislike, so by default it **does not
  mutate weights** (it's a read-only consumer of relevance). An env flag
  (`BROADCAST_RESOLVE_ON_PLAY`) can enable a small positive nudge on
  fully-played clips if wanted later. Called out because silently drifting
  weights from an unattended broadcast would corrupt the player's signal.

### 1.5 Control surface

- **Env:**
  - `RTMP_URL` — full ingest URL including stream key (or `RTMP_INGEST` +
    `RTMP_KEY` kept separate so the key can be masked in logs/UI).
  - `BROADCAST_WIDTH` / `BROADCAST_HEIGHT` / `BROADCAST_FPS` /
    `BROADCAST_BITRATE` — canonical output params.
  - `BROADCAST_SILENT_AUDIO`, `BROADCAST_RESOLVE_ON_PLAY`.
- **Action `broadcast`** (registered in `action/registry.js`), params
  `{ op: 'start' | 'stop' | 'status', url?, key? }`. Not a normal queue job — it
  owns a long-lived process — so it manages the pipeline lifecycle rather than
  running to completion. Only one broadcast at a time.
- **Status:** a `broadcast:state` socket event + a `/broadcast/status` HTTP
  endpoint reporting `{ live, uptime, currentKey, target (key masked),
  segmentsAhead, lastError }`. (Viewer counts need the YouTube API and are out of
  scope for generic RTMP.)

### 1.6 Files — `zap-api`

New:
- `utils/broadcast.js` — the pipeline: persistent encoder, per-clip TS
  normaliser, playout buffer, filler loop, lifecycle (start/stop/status).
- `action/broadcast.js` — the control action.
- `scripts/idle-card.mjs` (or generated inline) — builds the filler TS once.

Edited:
- `utils/selection.js` — add the `typePattern` filter option (backwards
  compatible; existing callers unaffected).
- `action/registry.js` — register `broadcast`.
- `session.js` — wire `broadcast` control + emit `broadcast:state`.
- `Dockerfile` — already ships ffmpeg with libx264/aac; no change expected
  (verify `-c:v libx264` present in the Debian build).

Tests (`test/broadcast.test.js`): the *pure* logic is what's unit-testable —
the video-only selection filter, the playout buffer's next-segment/filler
decision, stream-key masking, and lifecycle state transitions. ffmpeg itself is
exercised via a thin, injectable spawn seam so tests don't need a real encoder.

### 1.7 Client — see `zap-cli` doc

A `BroadcastPanel.vue` (start/stop, LIVE indicator, current clip, masked
target), `useSession` gains `startBroadcast` / `stopBroadcast` and a
`broadcastState` ref fed by `broadcast:state`.

### 1.8 Risks

- **TS timestamp continuity** across segment boundaries is the main technical
  risk; mitigated by uniform encode params + `genpts`. Prototype early against a
  real RTMP sink.
- **CPU:** normalising ahead-of-time is one extra transcode per clip; it must
  keep ahead of playout. The filler loop covers the case where it doesn't.
- **Single broadcast**, single RTMP target, by design.

---

## 2. Agent-built prompts / missions

### 2.1 Goal

The system composes **missions** — a question, task, or challenge — drawn from
the library's own lexical vocabulary. The user answers with **text, image, or
video**. The answer is stored as a new document **pre-tagged with the mission's
terms**, so it enters the graph *already lexically related* and its terms become
seeds for finding new media. This closes a loop:

```
lexical vocabulary ─▶ mission ─▶ user answer (text/image/video)
        ▲                              │
        │                              ▼
   richer graph ◀─ edges + term-biased fetch ◀─ answer tagged with terms
```

### 2.2 Where the vocabulary comes from

`utils/vocabulary.js` (new) builds a weighted term list from the `data`
collection:

- `subjects` / `labels` from `analyse.js` — concrete nouns ("bicycle",
  "person"), with `coverage` and frequency.
- Feed text titles / `summarizedFrom` — optional keyword extraction (stopword-
  filtered frequency) for terms that never appear as image subjects.

Each term carries a **frequency** and a **graph-density** score (how many
documents / edges already reference it). Missions deliberately favour terms that
are *sparse* in the graph — that is the "lexically-bound find for new media"
intent: prompt the user about what the library is thin on, so answers fill gaps.

### 2.3 Mission model (new `missions` collection)

Missions live in their own collection — like `feeds`, they are not media and must
never appear in playback. `model/mission.js` (new) defines and validates:

```js
{
  key,          // stable id, e.g. "mission-<hash>"
  kind,         // 'find' | 'create' | 'answer'
  prompt,       // rendered text shown to the user
  terms: [{ label, weight }],   // lexical terms this mission is about
  accepts,      // ['image','video','text'] — allowed answer media
  origin,       // 'template' (future: 'llm')
  template,     // which template produced it
  status,       // 'open' | 'answered' | 'dismissed' | 'expired'
  responses,    // document keys produced in answer
  createdAt, answeredAt,
}
```

### 2.4 The generator (the "agent")

A template engine behind a small interface, so the choice of generator is a
detail:

- `missions/generator.js` — `MissionGenerator` interface:
  `generate(vocabulary, options) -> mission`.
- `missions/templates.js` — the `TemplateGenerator` implementation. Each template
  declares its `kind`, `accepts`, term **arity**, and a term-selection strategy
  (`frequent` / `rare` / `co-occurring` / `random`). Examples:

  | template | kind | accepts | prompt |
  |---|---|---|---|
  | one-term find | find | image, video | "Show me something with **{term}**." |
  | pair create | create | image, video | "Capture **{a}** and **{b}** together." |
  | text memory | answer | text | "Describe a memory involving **{term}**." |
  | contrast | find | image, video | "Find the opposite of **{term}**." |

  The set is data-driven and extensible; adding a template is adding a row, not
  editing the engine.

- `cognition/prompt.js` (new) — a scheduled task, registered in `index.js`
  alongside `relate` / `generate`. Each tick: if open missions < a small cap,
  build the vocabulary, pick a template + terms (biasing toward sparse terms),
  render, and store an `open` mission.

An LLM generator (`origin: 'llm'`) is a future drop-in behind
`MISSION_GENERATOR=llm`; nothing else changes. Not built this pass.

### 2.5 Answering a mission

- **Server action `respond`** (new; registered in `action/registry.js`), params
  `{ missionKey, text? , upload? }`:
  1. Ingest the answer into `data`, reusing `action/upload.js` (image/video) or a
     text write like `action/ingest.js` (text). The new document gets
     `origin: 'mission'` and `missionKey`.
  2. **Pre-seed `labels` / `subjects`** with the mission's terms, so the answer
     is linkable *immediately*, before `analyse` runs. `analyse` can later
     confirm/augment (image/video answers still get analysed normally).
  3. **Create edges** from the answer to existing documents that share those
     terms, via `action/connect.js` with `SUBJECT` / `THEME`. The answer lands in
     the graph on arrival; `cognition/relate.js` keeps extending it; playback
     traversal reaches it.
  4. Mark the mission `answered` and record the response key(s).
- **Client:** `MissionPanel.vue` shows the current open mission. Text answers go
  through a textarea; image/video answers reuse the existing upload pipeline.

### 2.6 Closing the lexical loop (finding new media)

The mission terms become **fetch seeds**:

1. **Feed-biased ingest (in scope).** Extend `action/ingest.js` /
   `cognition/generate.js` so that, when open missions exist, feed items and
   analysis/relate work are **prioritised by mission terms** — content growth
   bends toward what the user is being prompted about.
2. **External discovery (future, noted).** A `discover` action that queries an
   external media source by term would need an outbound API + credentials, which
   the local-only choice steers away from for now. Feeds are the fetch channel in
   this pass.

### 2.7 Files — `zap-api`

New: `model/mission.js`, `utils/vocabulary.js`, `missions/generator.js`,
`missions/templates.js`, `cognition/prompt.js`, `action/mission.js`
(list / get / generate / dismiss), `action/respond.js`.

Edited: `action/registry.js` (register `mission`, `respond`), `index.js`
(register the `prompt` cognition task), `session.js` (emit `mission:state`,
handle `mission:answer`), optionally `action/ingest.js` +
`cognition/generate.js` (term-biased strategies).

Tests: `test/vocabulary.test.js`, `test/mission.test.js` (model + templates +
generator determinism given a seeded vocabulary), `test/respond.test.js`
(ingest + pre-tag + edge creation + mission close).

### 2.8 Client — see `zap-cli` doc

`MissionPanel.vue` + a `mission` store slice + `useSession` handlers
(`mission:state`, `answerMission`).

### 2.9 Risks

- **Repetitiveness** of template missions → mitigated by term-selection variety,
  a template pool, and the LLM seam.
- **Trust:** pre-seeding terms assumes a user's answer really is "about" the term;
  acceptable, and `analyse` cross-checks image/video answers.
- **UX:** missions must not interrupt playback — a dismissible panel, never a
  modal over the player.

---

## 3. Recommended phasing

1. **Streaming** — self-contained, reuses the selection loop, no schema changes
   beyond the selection filter. Ship first.
2. **Mission model + generator + panel + answer wiring** — the core of feature 2.
3. **Close the lexical loop** — term-biased ingest/generate; external `discover`
   only if an approved media API is added.

Each phase is independently reviewable and independently useful.

---

## 4. Open questions for sign-off

1. **Streaming weights:** confirm the broadcast should *not* touch weights by
   default (recommended).
2. **Silent audio track:** OK to inject a silent AAC track so YouTube accepts the
   "video-only" feed? (Recommended — otherwise many RTMP sinks reject it.)
3. **Internal HLS preview:** want the near-free self-hosted HLS monitor added
   alongside RTMP, or RTMP only?
4. **Mission cadence:** how visible should missions be — a quiet panel the user
   opens, or an occasional prompt surfaced between items?
5. **Answer analysis:** run `analyse` on image/video answers automatically (adds
   CPU) or only pre-tag from mission terms?

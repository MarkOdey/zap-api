# Design: Live streaming & agent-built prompts

Status: **proposal, awaiting sign-off** · No code has been written yet.
Scope: two features spanning `zap-api` (engine) and `zap-cli` (Vue client).
This is the authoritative document; `zap-cli/docs/design/streaming-and-prompts.md`
covers the client surface in more detail and refers back here.

Decisions already taken (from the request):

- **Streaming target:** generic RTMP, YouTube-ready — a configurable ingest URL +
  stream key, so the same feature works with YouTube Live, Twitch, or any RTMP
  sink. No YouTube-specific OAuth/Live API wiring.
- **Prompt engine (revised):** a **local LLM agent via Ollama** is the primary
  generator — it authors broad, open-ended missions ("Get a picture of a dog",
  "Film yourself falling down", "Who died recently?"). Ollama runs as a local HTTP
  service, so this stays fully on-device with no API key and no cloud, in keeping
  with the existing local-model design (segmenter, Kokoro TTS, distilbart). The
  generator is pluggable behind one interface; a **runtime-editable prompt bank**
  (a Mongo collection managed from the client) both **seeds/steers** the LLM and
  serves as the **fallback** when Ollama is unreachable. The earlier
  "local/template only" decision is superseded by this — templates survive only as
  the offline fallback shape.

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

> **"Only video" and audio — DECIDED: exclude clips without audio.** YouTube Live
> (and most RTMP sinks) reject a stream with no audio track. Rather than inject
> synthetic silence, the broadcast **only airs videos that already carry their own
> audio track** — clips with no audio are simply not selected. This keeps the feed
> a genuine audio+video program of real clips and sidesteps silent-stream
> rejection. It requires the selection layer to know which videos have audio (see
> §1.4). Superseded options (silent-AAC injection, truly-no-audio) are not built.

**Self-hosted HLS preview — DECIDED: build it alongside RTMP.** The API also
writes an `.m3u8` + segments served over `/broadcast/live.m3u8`, so the operator
can watch the exact feed in the browser (`BroadcastPanel`) without opening
YouTube. The normalise-to-TS design makes this nearly free — the same canonical TS
segments feed both the RTMP encoder and the HLS window (a rolling playlist of the
last N segments). RTMP remains the primary output.

### 1.4 Reuse of the player mechanism

- **Selection.** Extend `selectionPipeline` (`utils/selection.js`) with an
  optional **match filter** so a draw can be restricted to `video/*` **that carry
  an audio track** (per the decision above). Today the `$match` keys on `weight`
  and an optional `keys` list; add an optional `match` object (e.g.
  `{ type: /^video\//, hasAudio: true }`) merged into the same `$match`. Traversal
  restricts edge-target candidates the same way.
- **Knowing which videos have audio.** Aggregation can't run ffprobe, so audio
  presence is **precomputed** onto the document as `hasAudio: boolean` (and, while
  we're probing, `duration` / `width` / `height`, useful to the normaliser). This
  is filled by extending `action/explore.js` (or a dedicated probe step) using the
  existing `utils/ffprobe.js` `probeStreams`. As a safety net the broadcast also
  ffprobes a clip just before airing and skips it if audio is absent, so a stale or
  missing `hasAudio` never puts a silent clip on air.
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

A **local LLM agent** composes **missions** — broad, open-ended questions, tasks,
or challenges of the kind a person would set: *"Get a picture of a dog", "Film
yourself falling down", "Tell me a quote of the day", "Who died recently?", "Is
there a holiday going on today?"*. The user answers with **text, image, or
video**. Each mission carries the lexical **term(s)** it implies (from the prompt
itself — "dog", "fall", "holiday"), so the answer is stored **pre-tagged**, enters
the graph *already lexically related*, and its terms become seeds for finding new
media. This closes a loop:

```
LLM agent (Ollama) ─▶ mission ─▶ user answer (text/image/video)
        ▲    ▲                          │
   bank/steer library                   ▼
        │    │      richer graph ◀─ edges + term-biased fetch ◀─ answer tagged with terms
```

The missions are broad and world-facing, **not** confined to what the library
already contains — that is the whole point of using a generative agent rather than
templates over existing subjects.

### 2.2 Steering context (optional, not the source)

Unlike the earlier template design, the library vocabulary is **input to steer**
the agent, not the source of prompts. `utils/vocabulary.js` (new) builds a light
weighted term list from `data` — `subjects` / `labels` from `analyse.js`, feed-
text keywords — each with a **graph-density** score (how many docs/edges reference
it). The agent is optionally told which terms the library is *thin* on, so it can
lean prompts toward filling gaps ("lexically-bound find for new media"). The agent
is free to ignore it and ask something entirely new; steering is a nudge, not a
constraint. Dynamic hints (today's date, whether a subscribed feed has fresh
items) are passed the same way, enabling topical prompts like the holiday/obituary
examples without hard-coding them.

### 2.2a Time-aware themes (the hourly agent)

The strongest form of that dynamic steering is a **theme**: on a slow cadence
(default hourly) the agent produces a themed **lexicon** that steers everything
downstream. Two inputs feed it — the **calendar** (season, nearby holidays) and a
**domain schedule** (which *kind* of theme suits this hour). The inputs give the
*anchor*; the LLM gives the *words* — so nothing is hard-coded per holiday or
domain.

- **Domains (the palette).** Beyond seasonal, themes are drawn from a set of
  intellectual/cultural **domains**: `history`, `philosophy`, `art`, `science`,
  `nature`, `music`, `literature`, `culture`, `love` (affection, longing,
  connection — evocative and warm), `religion` (spirituality, ritual, myth and
  tradition, handled respectfully and comparatively — never proselytizing or
  disparaging), `controversial` (debate-worthy big questions — ethics, society,
  the future — framed for reflection), plus `seasonal`. The two sensitive domains
  (`religion`, `controversial`) are framed for reflection and scheduled to quieter
  hours; the generator deny-list still bars harmful content in every domain. The
  list is **runtime-editable** (stored, edited from the client), so you can add or
  retire domains without a redeploy.
- **Hourly schedule (appropriate theme per hour).** A `themeSchedule` maps each
  hour (or time-of-day band) to a weighted set of domains — e.g. mornings lean
  `nature` / `science` / light seasonal, afternoons `art` / `history` / `culture`,
  late evening `philosophy` / `literature`, late night `controversial`. Weekends
  can differ from weekdays. `love` sits in the evenings (and rides Valentine's
  seasonal), `religion` in reflective evening/quiet hours. Seasonal is always
  eligible and, when a holiday is
  near, it outweighs the scheduled domain (Halloween wins on Oct 31 whatever the
  hour). The schedule is a sensible default, **runtime-editable** like the domains,
  and doubles as light appropriateness-gating (heavier/controversial domains are
  simply scheduled to later hours).
- **`utils/calendar.js`** (new, pure/local) computes the factual half: `{ date,
  dayOfYear, weekday, timeOfDay, season, nearbyHolidays: [{ name, daysAway }] }`.
  Holidays come from a small local dataset (fixed-date ones like Halloween,
  Christmas, New Year, plus a few approximate movable ones, clearly marked). No
  network, no LLM — just facts.
- **The agent picks a domain and expands it.** `cognition/theme.js` reads the
  calendar + the hour's scheduled domains, chooses one (weighted; holiday-seasonal
  can pre-empt), and `OllamaGenerator.generateTheme({ calendar, domain })` returns
  `{ label, terms[] }`:
  - *domain `seasonal`, near Halloween* → `{ label: "Halloween", terms:
    ["pumpkin","ghost","spooky","autumn","fog", …] }`
  - *domain `philosophy`, late evening* → `{ label: "Free will", terms:
    ["choice","determinism","mind","fate","agency","ethics", …] }`
  - *domain `art`, afternoon* → `{ label: "Impressionism", terms:
    ["light","brushstroke","Monet","colour","garden","fleeting", …] }`
  Strict JSON, validated, one retry, then a calendar/domain-only fallback (a plain
  label with a tiny built-in seed list) so a theme always exists.
- **`themes` collection / current-theme doc:** `{ period, domain, label, terms[],
  calendarContext, generatedAt, expiresAt }`. One current theme at a time; history
  kept for inspection.
- **`cognition/theme.js`** (new) — scheduled hourly (`THEME_INTERVAL_MS`); when the
  current theme is missing or expired, assemble the context (recurrence first —
  §2.2b — then the scheduled domain and calendar), generate, store. Registered in
  `index.js`.

### 2.2b Recurrence — what played at analogous times (the primary anchor)

Rather than trust a hand-set hour→domain schedule, the strongest steering signal is
the system's **own history**: the lexicon of what actually played at *analogous*
moments — yesterday this hour, the same weekday last week, the same date last
month and last year. If last October 31st was full of pumpkins and last Sunday
morning was landscapes, this year's matching slot should lean the same way, learned
rather than declared.

- **Play history (new dependency).** A `plays` collection records each item as it
  airs: `{ key, terms, resolved, at, hour, weekday, dayOfYear }`, written from
  `action/play.js` (the terms are the doc's `labels`/`subjects`; `resolved` marks
  whether it was liked/finished vs skipped). Small, append-only, prunable by age.
  This is the one new piece of plumbing recurrence needs.
- **`utils/recurrence.js`** (new) — given `now`, query plays in analogous windows
  (yesterday ±1h, same weekday last week ±1h, same date last month/last year ±N
  days) and aggregate a **weighted term list**, weighting by how well the window
  matches (same-hour > same-weekday > same-date-last-year), by frequency, and by
  `resolved` (what was enjoyed at that time counts more than what was skipped).
- **How it feeds the theme.** The recurrence lexicon is the **primary** context
  handed to `generateTheme`: "at this time you've tended toward *{these terms}* —
  give a fitting theme label and lexicon." The scheduled domain (§2.2a) and
  calendar become **fallbacks / flavour**: used to pick a domain when history is
  thin, and always in play near a holiday. So the hour→domain schedule matters most
  at **cold start** (no history yet) and fades as the log fills.
- **Graceful cold start.** No/low history ⇒ fall back to schedule + calendar
  exactly as §2.2a describes, so the feature works from day one and gets more
  personal over weeks and seasons.

**What the theme steers** (this is the "use that lexicon to find media" part):

1. **Missions** — the current theme's terms are added to the mission steering
   context, so a Halloween evening tilts toward *"Get a picture of a pumpkin"* and
   a philosophy late-night toward *"What does free will mean to you?"*. Missions
   still range freely; the theme just tilts them.
2. **Lexical fetch** — the theme terms join the mission terms as **fetch seeds**
   for the term-biased ingest/relate work in §2.6, so content growth bends toward
   the current theme.
3. **Selection (optional, flagged)** — `THEME_BIAS` (default off) can add a gentle
   score boost in `selectionPipeline` for documents whose `labels`/`subjects`
   intersect the theme terms, so the player — and the broadcast (§1) — lean into
   the theme without excluding anything. Off by default so it never surprises; a
   dial rather than a filter.

The theme is a small, cheap, once-an-hour LLM call whose product (a word list) is
reused everywhere, rather than re-deriving the day's or hour's mood on every
mission or query.

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
  origin,       // 'ollama' | 'bank' | 'template' — which generator produced it
  source,       // model name (e.g. 'llama3.2') or bank-prompt id
  status,       // 'open' | 'answered' | 'dismissed' | 'expired'
  responses,    // document keys produced in answer
  createdAt, answeredAt,
}
```

### 2.4 The agent (local LLM via Ollama)

One interface, three interchangeable backends, chosen by `MISSION_GENERATOR`
(default `ollama`):

- `missions/generator.js` — `MissionGenerator` interface:
  `generate(context) -> mission`, where `context` carries the optional steering
  (sparse terms, date, fresh-feed flags) and the recent-mission history (so the
  agent avoids repeating itself).

- **`missions/ollama.js` — `OllamaGenerator` (primary).** Calls a **local Ollama**
  HTTP endpoint (`OLLAMA_URL`, default `http://localhost:11434`, model
  `OLLAMA_MODEL`, default a small instruct model such as `llama3.2`). A fixed
  system prompt asks for one broad, open-ended mission answerable by a person with
  a phone, returned as strict JSON: `{ prompt, accepts, terms, kind }`. The
  response is parsed and validated against `model/mission.js`; malformed output is
  retried once, then falls through to the bank. No API key, nothing leaves the
  machine. Ollama's `/api/generate` with `format: "json"` (or the `/v1` OpenAI-
  compatible route) keeps the output parseable.

- **`missions/bank.js` — `BankGenerator` (fallback + your own prompts).** Draws
  from a **runtime-editable `prompts` collection** (see §2.4a): the user's pinned
  broad prompts, seeded with a starter set. Picks least-recently-used, avoiding
  repeats. This is what runs when Ollama is unreachable, so missions never stop.

- **`missions/template.js` — `TemplateGenerator` (offline last resort).** The
  minimal library-derived shape from the earlier design, kept only so the feature
  degrades gracefully with neither Ollama nor a bank.

- `cognition/prompt.js` (new) — scheduled task, registered in `index.js` alongside
  `relate` / `generate`. Each tick: if open missions < a small cap, build the
  steering context and call the configured generator (with automatic fallback down
  the chain ollama → bank → template), then store an `open` mission.

The agent extracts `terms` for the lexical hook: the LLM returns them directly;
the bank/template carry them per prompt. A short deny-list keeps prompts safe and
answerable (nothing requiring travel, purchase, or anything unsafe).

### 2.4a The runtime prompt bank (`prompts` collection)

Per the authoring decision, the bank is **stored in Mongo and edited from the
client**, not a code file:

- `prompts` collection: `{ id, text, accepts[], terms[], enabled, tags[],
  createdAt, lastUsedAt }`.
- `action/prompt.js` (new) — `{ op: 'list'|'add'|'update'|'remove'|'seed', ... }`,
  so the client can maintain the bank at runtime. `seed` loads a small starter set
  on first run (idempotent).
- The bank both **feeds `BankGenerator`** and can **steer Ollama** (a few of the
  user's prompts included as style examples), so your authored voice shapes even
  the LLM-generated ones.

### 2.4b Running Ollama

Ollama is an external local service, not bundled in the current image. Options,
documented in the README: run it on the host and point `OLLAMA_URL` at it, or add
an `ollama` service to `docker-compose.yml` (with a model-pull init). Because the
generator falls back to the bank, the feature works with or without Ollama
present — Ollama upgrades mission quality and variety rather than being required.

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

The **mission terms and the current theme's terms** together become **fetch
seeds**:

1. **Feed-biased ingest (in scope).** Extend `action/ingest.js` /
   `cognition/generate.js` so that, when open missions or an active theme exist,
   feed items and analysis/relate work are **prioritised by those terms** — content
   growth bends toward what the user is being prompted about and toward the season
   (so late October pulls in and links the autumn/Halloween-tinged media first).
2. **External discovery (future, noted).** A `discover` action that queries an
   external media source by term would need an outbound API + credentials, which
   the local-only choice steers away from for now. Feeds are the fetch channel in
   this pass — and the theme lexicon is exactly the query such a `discover` would
   use if one is added later.

### 2.7 Files — `zap-api`

New: `model/mission.js`, `model/theme.js` (theme incl. `domain`), `missions/
domains.js` (default domain palette — incl. `love` and `religion` — + hourly
`themeSchedule`, both runtime-overridable), `model/play.js` (play-log shape),
`utils/vocabulary.js`, `utils/calendar.js` (local date/season/holiday facts),
`utils/recurrence.js` (aggregate the lexicon of plays at analogous times),
`missions/generator.js` (interface + fallback chain, incl.
`generateTheme({recurrence, domain, calendar})`), `missions/ollama.js`,
`missions/bank.js`, `missions/template.js`, `utils/ollama.js` (thin HTTP client),
`cognition/prompt.js`, `cognition/theme.js` (hourly: recurrence first, then domain
+ calendar, then generate), `action/mission.js` (list / get / generate / dismiss),
`action/prompt.js` (bank CRUD + seed), `action/theme.js` (get / regenerate current
theme; get/set the domains + schedule), `action/respond.js`.

Edited: `action/play.js` (append a `plays` record as each item airs),
`action/registry.js` (register `mission`, `prompt`, `theme`, `respond`),
`index.js` (register the `prompt` and `theme` cognition tasks), `session.js`
(emit `mission:state` + `theme:state`, handle `mission:answer`),
`utils/selection.js` (optional `THEME_BIAS` score boost), optionally
`action/ingest.js` + `cognition/generate.js` (term-biased strategies).

Tests: `test/vocabulary.test.js`, `test/mission.test.js` (model + bank/template
generators + JSON parsing/validation of an Ollama response, with the HTTP client
mocked), `test/prompt.test.js` (bank CRUD + seed idempotency), `test/respond.test.js`
(ingest + pre-tag + edge creation + mission close). Ollama is exercised through an
injectable HTTP seam so tests need no running model.

### 2.8 Client — see `zap-cli` doc

`MissionPanel.vue` + a `mission` store slice + `useSession` handlers
(`mission:state`, `answerMission`).

### 2.9 Risks

- **Ollama availability:** it's an external local service. Mitigated by the
  fallback chain (ollama → bank → template) so missions never stop, and by the
  bare-metal-or-compose install options in §2.4b.
- **LLM output quality/safety:** open-ended generation can drift off-format or
  suggest something unanswerable/unsafe. Mitigated by `format: json` + schema
  validation + one retry, a deny-list, and the bank fallback. A small instruct
  model is enough — missions are one short sentence.
- **Repetitiveness:** history is passed in the steering context so the agent
  avoids recent repeats; the bank uses least-recently-used.
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

## 4. Decisions (resolved)

1. **Audio:** the broadcast **airs only videos that already have an audio track**;
   silent clips are excluded (no synthetic silence). §1.3 / §1.4.
2. **HLS preview:** **built** alongside RTMP — `/broadcast/live.m3u8` for an
   in-browser monitor. §1.3.
3. **Mission surfacing:** **both, toggleable** — a quiet panel always, plus an
   opt-in "nudge" setting that occasionally surfaces a mission between items.
4. **Streaming weights:** the broadcast does **not** mutate weights by default
   (read-only consumer of relevance); env flag can enable it later. §1.4.
5. **Answer analysis:** image/video answers are **pre-tagged from mission terms
   immediately and also queued for `analyse`** to confirm/augment. §2.5.
6. **Mission generator:** a **local LLM agent via Ollama** is primary (broad,
   open-ended prompts), with automatic fallback to a bank then a template so it
   never stalls. §2.4.
7. **Prompt bank authoring:** a **runtime-editable `prompts` collection** managed
   from the client (seeded with a starter set), not a code file. §2.4a.
8. **Time-aware themes:** an **hourly** agent produces a themed **lexicon** that
   steers missions and the media-finding loop (optional flagged theme-bias in
   selection). Its **primary** input, once history exists, is **recurrence** — the
   lexicon of what actually played at analogous times (yesterday this hour, same
   weekday last week, same date last year), weighted by how much it was enjoyed;
   this needs a small `plays` log. The **domain palette + hour→domain schedule**
   (history, philosophy, art, science, love, religion, controversial, seasonal, …;
   runtime-editable) are the **cold-start fallback** and holiday flavour. Sensitive
   domains (`religion`, `controversial`) are framed for reflection and scheduled to
   quieter hours. Calendar facts are local; the LLM supplies the words. §2.2a/§2.2b.

The concrete build order and task breakdown for these decisions is in
`docs/plan/streaming-and-prompts.md`.

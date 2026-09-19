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
6. **Mission generator:** a **local LLM agent via Ollama** authors broad,
   open-ended prompts (primary), with automatic fallback to a runtime bank then a
   template so it never stalls.
7. **Prompt bank:** a **runtime-editable `prompts` collection** managed from the
   client (seeded with a starter set), not a code file.
8. **Time-aware themes:** an **hourly** agent turns local calendar facts (season /
   nearby holidays / time of day) **plus a scheduled domain** (history, philosophy,
   art, science, love, religion, controversial, seasonal, …) into a themed lexicon
   that steers missions and the media-finding loop; theme-bias in playback selection
   is optional and off by default. The domain palette and the hour→domain schedule
   are runtime-editable, with sensitive domains (religion, controversial) framed for
   reflection and scheduled to quieter hours. `llama3.2` supplies the words; the
   calendar + schedule supply the anchor.

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

## Phase 3 — Mission model, local LLM agent & prompt bank (engine)

The core of feature 2. Independent of Phases 0–2. The generator is a **local LLM
agent via Ollama** (primary) with a runtime-editable bank and a template as
fallbacks — see design §2.4/§2.4a/§2.4b.

- [ ] **`model/mission.js`** (new) — schema + `validate` / `normalize`
  (`key, kind, prompt, terms[], accepts[], origin, source, status, responses[],
  createdAt, answeredAt`). `missions` collection (never in playback).
- [ ] **`utils/ollama.js`** (new) — thin HTTP client for a local Ollama
  (`OLLAMA_URL`, default `http://localhost:11434`), `generate(prompt,{format:'json'})`
  with timeout + injectable `fetch` seam. Reports reachability so callers can fall
  back cleanly.
- [ ] **`missions/generator.js`** (new) — `MissionGenerator` interface
  `generate(context) -> mission` + the fallback chain (ollama → bank → template),
  selected by `MISSION_GENERATOR` (default `ollama`).
- [ ] **`missions/ollama.js`** (new) — `OllamaGenerator`: system prompt for one
  broad, open-ended mission; parse/validate strict JSON `{prompt,accepts,terms,
  kind}`; one retry then fall through. Deny-list for unsafe/unanswerable prompts.
- [ ] **`missions/bank.js`** (new) — `BankGenerator`: least-recently-used draw
  from the `prompts` collection; also supplies a few examples to steer Ollama.
- [ ] **`missions/template.js`** (new) — minimal library-derived last resort.
- [ ] **`utils/vocabulary.js`** (new) — light term list from `data` + graph-density,
  used only as **steering context** (sparse terms, plus date / fresh-feed hints).
- [ ] **`utils/calendar.js`** (new, pure) — local calendar facts `{ date, dayOfYear,
  weekday, timeOfDay, season, nearbyHolidays[] }` from a small built-in holiday
  dataset. No network, no LLM.
- [ ] **`missions/domains.js`** (new) — default **domain palette** (history,
  philosophy, art, science, nature, music, literature, culture, love, religion,
  controversial, seasonal) + default **hour→domain `themeSchedule`** (weighted;
  weekday/weekend; `love` in the evenings/Valentine's, sensitive domains `religion`
  + `controversial` framed for reflection and scheduled to quieter hours). Both
  overridable at runtime via a stored config.
- [ ] **`model/theme.js`** (incl. `domain`) + **`missions/ollama.js`
  `generateTheme({calendar, domain})`** — hourly LLM call expands the picked domain
  + calendar facts into `{ label, terms[] }` (strict JSON, validated, calendar/
  domain-only fallback). Stored in a `themes` collection (current + history).
- [ ] **`cognition/theme.js`** (new) + **`index.js`** — hourly task
  (`THEME_INTERVAL_MS`): pick a domain from the schedule (seasonal pre-empts near a
  holiday), generate the theme, feed its terms into the mission steering context.
- [ ] **`action/theme.js`** (new) + registry — `{ op: 'get'|'regenerate' }` plus
  `{ op: 'getSchedule'|'setSchedule'|'setDomains' }` for runtime editing.
- [ ] **`action/prompt.js`** (new) + registry — bank CRUD:
  `{ op: 'list'|'add'|'update'|'remove'|'seed' }`; `seed` is idempotent.
- [ ] **`cognition/prompt.js`** (new) + **`index.js`** — scheduled task: when open
  missions < cap, build steering context and call the generator (with fallback).
- [ ] **`action/mission.js`** (new) + registry — `{ op: 'list'|'get'|'generate'
  |'dismiss', ... }`.
- [ ] **Env & docs** — `MISSION_GENERATOR`, `OLLAMA_URL`, `OLLAMA_MODEL`
  (`llama3.2`), `THEME_INTERVAL_MS` (default 1h); README section on running
  Ollama on the host or as a `docker-compose` service, noting the bank fallback
  means it's optional.

**Tests:** `test/vocabulary.test.js`; `test/calendar.test.js` (season/holiday-
proximity facts for fixed dates, incl. a near-Halloween date); `test/domains.test.js`
(schedule picks the right domain set for an hour; seasonal pre-empts near a holiday;
runtime override applies); `test/mission.test.js` (model + bank/template generators
+ Ollama JSON parse/validate with the HTTP seam mocked + fallback chain);
`test/theme.test.js` (domain+calendar prompt shaping, theme JSON parse/validate +
fallback); `test/prompt.test.js` (bank CRUD + seed idempotency).

**Acceptance:** with Ollama running, `mission generate` yields a well-formed, broad
open-ended mission carrying its lexical terms; with Ollama stopped, it falls back
to the bank and still produces one; the cognition task keeps a small pool of open
missions without repeating recent ones. The hourly theme task picks a domain
appropriate to the hour (art in the afternoon, philosophy late evening), pre-empts
with seasonal near a holiday, produces a matching lexicon, and that lexicon appears
in the mission steering context.

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
  `action/ingest.js` so that when open missions **or an active theme** exist, feed
  ingest and analyse/relate work are prioritised by those terms (mission terms +
  theme lexicon). External `discover` action remains **out of scope** (needs an
  approved media API + network).
- [ ] **Optional theme-bias in selection** — behind `THEME_BIAS` (default off), add
  a gentle score boost in `utils/selection.js` for documents whose
  `labels`/`subjects` intersect the current theme terms, so the player and the
  broadcast lean into the season without excluding anything.

**Tests:** `test/respond.test.js` — ingest + pre-tag + `analyse` enqueued + edges
created + mission closed; term-biased strategy prefers mission + theme terms;
`THEME_BIAS` on boosts theme-matching docs and off changes nothing.

**Acceptance:** answering a mission produces a document that is immediately
reachable by traversal from library items sharing the term, and the mission moves
to `answered`. With a theme active, feed ingest/relate prefers the theme lexicon;
with `THEME_BIAS` on, seasonal media comes up more in playback (and the broadcast).

---

## Phase 5 — Mission client surface + prompt-bank admin (zap-cli)

Depends on Phases 3–4. Detailed in the zap-cli plan; summary:

- [ ] `stores/mission.js`, `useSession.js` (`mission:state` + `answerMission`),
  `components/MissionPanel.vue` (quiet panel + accepts-based answer affordance +
  opt-in "nudge" toast persisted in `localStorage`), `App.vue` mount + button.
- [ ] `components/PromptBankPanel.vue` — the **runtime bank admin**: list / add /
  edit / remove prompts and trigger `seed`, via `run('prompt', { op, ... })`. This
  is the "runtime collection + UI" authoring decision.
- [ ] **Theme display** — `useSession` handles `theme:state` → a `theme` ref; a
  small label (e.g. in `MissionPanel` header) shows the current theme
  ("🎃 Halloween") so the seasonal steering is visible.

**Acceptance:** an open mission shows in the panel; text/image/video answers
submit and clear the mission; the nudge toggle controls occasional surfacing and
never blocks playback; the operator can maintain the prompt bank from the client
without a redeploy; the current theme is visible.

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
5. **Ollama model & hosting** — model **`llama3.2` (confirmed)**. Still open:
   host Ollama on the machine (default) or add a `docker-compose` service.
6. **Theme cadence & bias** — regenerate the theme **hourly** (default) and keep
   theme-bias in playback **off** by default (a dial, not a filter). Confirm, or
   say if you'd rather the theme also visibly steer what plays out of the box.
7. **Holiday dataset scope** — start with a small fixed-date set (Halloween,
   Christmas, New Year, Valentine's, etc.) + season/time-of-day; movable holidays
   (Easter, Thanksgiving) added later. Confirm the starter set is enough.
8. **Domain palette & default schedule** — starter domains: history, philosophy,
   art, science, nature, music, literature, culture, love, religion, controversial,
   seasonal. A proposed default schedule: mornings nature/science + light seasonal,
   afternoons art/history/culture, evenings philosophy/literature/**love**, late
   night **religion**/controversial (reflective/quiet hours); seasonal pre-empts
   near holidays. Confirm the palette and the rough shape.
9. **Sensitive domains (`religion`, `controversial`)** — enabled and scheduled to
   quieter/reflective hours by default; `religion` framed respectfully and
   comparatively (spirituality, ritual, tradition — not proselytizing or
   disparaging), `controversial` as reflective debate; the deny-list still bars
   harmful content. Keep both on, restrict their hours further, or drop either?

None of these block starting Phase 0; they can be settled as each phase lands.

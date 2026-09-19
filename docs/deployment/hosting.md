# Hosting decision: local-first, private tunnel for remote

Status: **decision, to resolve the "how do we host this" blocker before building.**
Context: no dedicated hardware; streaming on demand (not 24/7); private remote
access for one person; concern that the project is resource-hungry and would be
costly in the cloud.

## TL;DR

**You have not locked yourself into an expensive project.** Run the whole stack
**locally on the computer you already use**, via Docker Compose, and reach it
privately from anywhere through a **tunnel** (Tailscale or Cloudflare Tunnel).
That costs **$0**, needs no rented server and no new hardware, and — because
nothing is ever publicly exposed — it also removes a whole class of security work.
Cloud or a mini-PC stay available as an *optional* later step if you ever decide
you want it always-on without your computer running.

## Why the "resource-hungry" fear is smaller than it looks

The project is only heavy when *everything runs at once, 24/7*. Your actual usage
is light and bursty. Costs are paid only while a heavy thing is actually running:

| Mode | What's running | Rough load |
|---|---|---|
| **Idle / browsing & playing** | api + mongo, selection loop, media over HTTP | tens of MB/s disk, ~fraction of a core, ~1 GB RAM |
| **Missions / hourly theme** | one llama3.2 call per hour via Ollama | a few seconds of CPU per hour; ~2–3 GB RAM only while the model is resident |
| **A generation job** (analyse / render / montage) | one ffmpeg or one ONNX inference, queued (concurrency 1) | one burst; inference peaks ~4.5 GB (already `mem_limit: 5g` in compose) |
| **Broadcasting** (on demand) | persistent ffmpeg encode → RTMP | ~1–2 cores *while live*, ~4.5 Mbps upstream; **only when you start it** |

Because streaming is **on demand** and generation is throttled by the queue and the
byte budget, the machine is quiet most of the time. A normal laptop/desktop with
**8–16 GB RAM** handles all of it for one person. Nothing here requires a GPU;
llama3.2 (3B) answers a one-sentence prompt in a few seconds on CPU.

## The decision

1. **Run locally.** One `docker compose up` on your own machine brings up
   `mongo` + `api` (+ `ollama`), with the media library and model cache on local
   volumes. Use it while you use it; it consumes nothing when stopped.
2. **Reach it privately with a tunnel** (see below) — your phone or another device
   anywhere connects as if on your LAN, with no port-forwarding and no public
   exposure.
3. **Stream on demand** — start the broadcast when you want it; stop it to reclaim
   the cores.
4. **Defer always-on hosting.** Only if you later want the channel/missions running
   while your computer is off do you need a mini-PC or a VPS (options below). Not
   now.

### Security bonus of this choice

Today CORS is open and the socket exposes a `run` action (and a terminal) that
executes server-side actions — safe on a LAN, but remote code execution if put on
the public internet. **Local + private tunnel means that surface is never publicly
reachable**, so the auth/hardening work becomes *optional* rather than a
prerequisite. Choosing this path deletes a task, it doesn't add one.

## How to run it locally

The repo already has a `Dockerfile` and `docker-compose.yml` (mongo + api +
volumes). Two additions make it the full stack:

- **Add an `ollama` service** to `docker-compose.yml` (image `ollama/ollama`, its
  own volume for the model, port 11434), set `OLLAMA_URL=http://ollama:11434` on
  the api, and pull the model once (`ollama pull llama3.2`). Because the mission
  generator falls back to the bank, the api still runs if Ollama is absent — so
  this service is optional even locally.
- **Serve the client**: `zap-cli` is a static Vite build; either run it in dev
  (`npm run dev`, already binds `host: true` for other devices) or build it and let
  the api serve the static files. For local use, dev mode is simplest.

Rough combined footprint with Ollama loaded: api (~4.5 GB peak during inference) +
ollama (~2–3 GB) + mongo (~0.5–1 GB). Comfortable on 16 GB, workable on 8 GB as
long as a big inference job and an Ollama call don't peak simultaneously (they
rarely do — the theme call is hourly and brief).

## Remote-private access (pick one, both free)

- **Tailscale (recommended).** Install on the host and on your phone/laptop; they
  join a private mesh. Reach the app at the host's Tailscale IP (e.g.
  `http://100.x.y.z:3000`). Nothing is exposed to the internet; no DNS or certs to
  manage. Simplest for "just me, from anywhere."
- **Cloudflare Tunnel.** A named tunnel gives a private hostname with a real TLS
  cert, gated behind Cloudflare Access (your login only). Slightly more setup;
  nicer if you want a stable URL. Still no inbound ports opened.

Either keeps the RTMP broadcast working unchanged (RTMP is *outbound* from the
host to YouTube, so it needs no inbound access at all).

## Collaborating on the project (the code)

"Collaborate" needs no hosting: both repos are on GitHub, and this is already how
we work — feature branches (`claude/streaming-agent-prompts-edy4hq`), commits, and
PRs. Anyone added to the repos develops and runs their own local stack the same
way. There is nothing to stand up for collaboration itself.

## If you later want always-on (optional, deferred)

Only worth it if you want the channel/missions running while your own computer is
off. Rough comparison:

| Option | One-off | Monthly | Notes |
|---|---|---|---|
| **Mini-PC** (e.g. Intel N100, 16 GB, 500 GB SSD) | ~$150–250 | ~$1–3 power | Best value for always-on; ~6–10 W idle; put it on Tailscale, same as local |
| **VPS** (e.g. Hetzner CPX41-class, ~4 vCPU / 8 GB) | — | ~€15–30 | No hardware; good upstream for 24/7 RTMP; media lives in the cloud |
| **Container PaaS** (Fly.io w/ volume + always-on machine) | — | usually more for this profile | Easiest ops, but 24/7 ffmpeg + Ollama fights the platform's grain; only if you dislike VMs |

A mini-PC on Tailscale is the natural graduation from the local-first setup: the
exact same compose stack, just on a box that's always on, still private, still $0
in cloud fees.

## What this decision unblocks for the build plan

- **Ollama** is trivially available (same host), so the mission/theme agent works
  out of the box; the bank fallback still covers "Ollama not running."
- **Broadcast** is on-demand only — no 24/7 encode assumption in sizing.
- **Public-hardening of `run`/the terminal is not a prerequisite** while access is
  local + private tunnel. It becomes required only if you later choose public
  access; note it as a gate on that future choice, not on Phase 0.

## Open (small, non-blocking)

1. **Tunnel choice** — Tailscale (recommended, simplest) vs Cloudflare Tunnel
   (stable hostname). Either can change later.
2. **Client serving** — dev server vs api-served static build for your day-to-day
   use. Dev is fine to start.

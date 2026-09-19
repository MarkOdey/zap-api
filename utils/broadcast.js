import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import MongoConnexion from './MongoConnexion.js';
import { selectionPipeline, traversalPipeline, TRAVERSAL_PROBABILITY } from './selection.js';
import { describeMedia } from './ffprobe.js';
import { SOUNDTRACK } from '../relation/statement.js';

/**
 * The live video broadcast.
 *
 * Reuses the player's selection loop (weight × recency, edge traversal) but the
 * sink is a persistent ffmpeg holding an RTMP connection rather than a browser
 * socket. Only videos that already carry an audio track are aired — YouTube (and
 * most RTMP sinks) reject a silent stream, and we do not synthesise audio.
 *
 * Continuity is the hard part: RTMP drops if the encoder ever exits between
 * clips. So one long-lived encoder holds the connection and each selected clip is
 * normalised to a canonical MPEG-TS stream fed into that encoder's stdin — TS is
 * designed to be concatenated. A black/silent filler loop feeds the encoder when
 * selection is empty or normalisation lags, so it never starves.
 *
 * The same encoder also writes an HLS playlist so the operator can watch exactly
 * what is going out, in the browser, without opening YouTube.
 *
 * ffmpeg is spawned through an injectable seam (`opts.spawn`) so the orchestration
 * is testable without a real encoder.
 */

export const WIDTH = Number(process.env.BROADCAST_WIDTH || 1280);
export const HEIGHT = Number(process.env.BROADCAST_HEIGHT || 720);
export const FPS = Number(process.env.BROADCAST_FPS || 30);
export const BITRATE = process.env.BROADCAST_BITRATE || '4500k';
/** How long one filler segment runs before selection is retried. */
export const FILLER_SECONDS = Number(process.env.BROADCAST_FILLER_SECONDS || 5);

const VIDEO_WITH_AUDIO = { type: { $regex: '^video/' }, hasAudio: true };

/** Never print a stream key to logs or status. `rtmp://host/app/KEY` → `…/****`. */
export function maskTarget(url) {
  if (!url || typeof url !== 'string') return null;
  const i = url.lastIndexOf('/');
  if (i === -1) return url;
  return `${url.slice(0, i)}/${'*'.repeat(Math.min(8, url.length - i - 1))}`;
}

/**
 * ffmpeg args that decode one clip and emit a canonical MPEG-TS stream on stdout:
 * fixed size (letter/pillar-boxed), fps, H.264/AAC, square pixels. `-re` paces it
 * to real time so the downstream encoder is fed at playback speed.
 */
export function normalizeArgs(input, { width = WIDTH, height = HEIGHT, fps = FPS, bitrate = BITRATE } = {}) {
  const scale = `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps},setsar=1`;
  return [
    '-hide_banner', '-loglevel', 'error',
    '-re', '-i', input,
    '-vf', scale,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
    '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', doubleRate(bitrate),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-f', 'mpegts', 'pipe:1',
  ];
}

/** A black frame + silence, looped, for when nothing is ready to air. */
export function fillerArgs({ width = WIDTH, height = HEIGHT, fps = FPS, bitrate = BITRATE, seconds = FILLER_SECONDS } = {}) {
  return [
    '-hide_banner', '-loglevel', 'error', '-re',
    '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}`,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t', String(seconds),
    '-vf', 'setsar=1',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-g', String(fps * 2), '-b:v', bitrate,
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-f', 'mpegts', 'pipe:1',
  ];
}

/**
 * ffmpeg args for the persistent encoder: read concatenated MPEG-TS from stdin
 * and relay it to RTMP (flv) and to an HLS playlist. The segments are already
 * canonical H.264/AAC, so this copies rather than re-encodes.
 *
 * `+genpts` and the TS demux keep timestamps monotonic across the segment
 * boundaries fed into stdin (each normalised clip starts its own timeline). If a
 * particular sink is fussy about the copied discontinuities, set
 * BROADCAST_REENCODE=true to re-encode here instead of copy.
 */
export function encoderArgs({ rtmpUrl, hlsDir, width = WIDTH, height = HEIGHT, fps = FPS, bitrate = BITRATE } = {}) {
  const reencode = process.env.BROADCAST_REENCODE === 'true';
  const codec = reencode
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
       '-g', String(fps * 2), '-b:v', bitrate, '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2']
    : ['-c', 'copy'];

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-fflags', '+genpts',
    '-f', 'mpegts', '-i', 'pipe:0',
  ];

  if (rtmpUrl) {
    args.push('-map', '0:v', '-map', '0:a?', ...codec, '-f', 'flv', rtmpUrl);
  }

  // HLS preview (rolling window; no endlist so players treat it as live).
  args.push(
    '-map', '0:v', '-map', '0:a?', ...codec,
    '-f', 'hls', '-hls_time', '4', '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+omit_endlist',
    '-hls_segment_filename', path.join(hlsDir, 'seg-%06d.ts'),
    path.join(hlsDir, 'live.m3u8'),
  );

  return args;
}

/** `4500k` → `9000k`, for the encoder buffer. */
function doubleRate(rate) {
  const n = parseInt(rate, 10);
  return Number.isFinite(n) ? `${n * 2}k` : rate;
}

/**
 * Pick the next video (with audio) to air. Mirrors action/play.js — edge
 * traversal most of the time, weighted-recency draw otherwise — but restricted to
 * `video/*` documents that carry audio.
 */
export async function nextVideo(db, currentKey) {
  const col = db.collection('data');
  const edgeCol = db.collection('edges');

  if (currentKey && Math.random() < TRAVERSAL_PROBABILITY) {
    const edges = await edgeCol.find({ from: currentKey, type: { $ne: SOUNDTRACK } }).toArray();
    if (edges.length) {
      const [hit] = await col
        .aggregate(traversalPipeline(edges.map(e => e.to), { match: VIDEO_WITH_AUDIO }))
        .toArray();
      if (hit) return hit;
    }
  }

  const [hit] = await col.aggregate(selectionPipeline({ match: VIDEO_WITH_AUDIO })).toArray();
  if (hit) return hit;

  // Weight threshold cleared nothing — draw again with it removed.
  const [any] = await col.aggregate(selectionPipeline({ threshold: -1, match: VIDEO_WITH_AUDIO })).toArray();
  return any ?? null;
}

/** One broadcast at a time for the whole process. */
let active = null;

export function current() {
  return active;
}

export class Broadcast {
  constructor({ rtmpUrl = null, spawn: spawnFn = spawn, probe = describeMedia, hlsDir = null, select = null } = {}) {
    this.rtmpUrl = rtmpUrl;
    this.spawn = spawnFn;
    this.probe = probe;
    this.hlsDir = hlsDir;
    // How the next clip is chosen; injectable so the loop is testable without a DB.
    this.select = select || (async (key) => nextVideo(await MongoConnexion.db(), key));

    this.live = false;
    this.startedAt = null;
    this.currentKey = null;
    this.lastError = null;
    this.segments = 0;

    this.encoder = null;
    this.source = null;
    this.stopped = false;
  }

  status() {
    return {
      live: this.live,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      currentKey: this.currentKey,
      target: maskTarget(this.rtmpUrl),
      segments: this.segments,
      lastError: this.lastError,
    };
  }

  async start() {
    if (this.live) throw new Error('broadcast: already live');

    this.hlsDir = this.hlsDir || await fsp.mkdtemp(path.join(os.tmpdir(), 'zap-hls-'));
    await fsp.mkdir(this.hlsDir, { recursive: true });

    this.encoder = this.spawn('ffmpeg', encoderArgs({ rtmpUrl: this.rtmpUrl, hlsDir: this.hlsDir }), {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    this.encoder.on('error', (err) => { this.lastError = `encoder: ${err.message}`; });
    this.encoder.on('close', (code) => {
      // If the encoder dies the broadcast is over; do not keep feeding a dead pipe.
      if (!this.stopped) this.lastError = `encoder exited (${code})`;
      this.live = false;
    });

    this.live = true;
    this.stopped = false;
    this.startedAt = Date.now();
    active = this;

    this.feedLoop().catch((err) => { this.lastError = err.message; });
    return this.status();
  }

  /** Keep the encoder's stdin fed: a normalised clip when one is ready, filler otherwise. */
  async feedLoop() {
    while (this.live && !this.stopped) {
      let doc = null;
      try {
        doc = await this.select(this.currentKey);
      } catch (err) {
        this.lastError = `select: ${err.message}`;
      }

      // On-air audio guard: even with hasAudio set, confirm before airing so a
      // stale flag never puts a silent clip on a stream that requires audio.
      if (doc) {
        try {
          const { hasAudio } = await this.probe(doc.source);
          if (!hasAudio) { doc = null; }
        } catch { doc = null; }
      }

      if (doc) {
        this.currentKey = doc.key;
        await this.feedProcess(normalizeArgs(doc.source));
      } else {
        await this.feedProcess(fillerArgs());
      }
    }
  }

  /** Spawn one source, pipe its stdout into the encoder without closing that stdin. */
  feedProcess(args) {
    return new Promise((resolve) => {
      if (!this.live || this.stopped || !this.encoder?.stdin?.writable) return resolve();

      const src = this.spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'inherit'] });
      this.source = src;
      // end:false keeps the encoder's stdin open for the next segment.
      src.stdout.pipe(this.encoder.stdin, { end: false });
      src.on('error', (err) => { this.lastError = `source: ${err.message}`; });
      src.on('close', () => {
        this.segments++;
        this.source = null;
        resolve();
      });
    });
  }

  async stop() {
    this.stopped = true;
    this.live = false;
    try { this.source?.kill('SIGKILL'); } catch { /* already gone */ }
    try { this.encoder?.stdin?.end(); } catch { /* already closed */ }
    try { this.encoder?.kill('SIGTERM'); } catch { /* already gone */ }
    if (active === this) active = null;
    // Best-effort cleanup of the HLS scratch dir.
    if (this.hlsDir) await fsp.rm(this.hlsDir, { recursive: true, force: true }).catch(() => {});
    return { stopped: true };
  }
}

/** Where the HLS route reads segments from, when a broadcast is live. */
export function hlsDir() {
  return active?.hlsDir ?? null;
}

/**
 * Serve the HLS preview and a status endpoint.
 *
 * Only the playlist and its numbered segments are served, by basename, from the
 * live broadcast's scratch dir — a crafted path cannot escape it.
 */
export function mountBroadcast(app) {
  app.get('/broadcast/status', (_req, res) => {
    res.json(active ? active.status() : { live: false });
  });

  app.get('/broadcast/:file', (req, res) => {
    const dir = hlsDir();
    if (!dir) return res.sendStatus(404);

    const name = req.params.file;
    if (!/^(live\.m3u8|seg-\d{1,10}\.ts)$/.test(name)) return res.sendStatus(400);

    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return res.sendStatus(404);

    res.set({
      'Content-Type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    });
    fs.createReadStream(file).pipe(res);
  });
}

export { fs };

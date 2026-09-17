import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import MongoConnexion from './MongoConnexion.js';

/**
 * HTTP media serving with byte-range support.
 *
 * Replaces base64-over-socket for playback. That approach could not stream or
 * seek, forced a 500MB socket buffer, and sent whole files as single messages —
 * the library's mean payload was 9MB and its largest was 95MB.
 *
 * Paths never come from the URL. The key is looked up in the library and the
 * stored `source` is used, then checked to be inside DATA_DIR, so a crafted key
 * cannot reach arbitrary files.
 */
export function mountMedia(app) {
  app.get('/media/:key', async (req, res) => {
    try {
      await serve(req, res);
    } catch (err) {
      console.error('media route error:', err.message);
      if (!res.headersSent) res.sendStatus(500);
    }
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
}

async function serve(req, res) {
  const key = req.params.key;
  if (!key) return res.sendStatus(400);

  const db = await MongoConnexion.db();
  const doc = await db.collection('data').findOne({ key });
  if (!doc?.source) return res.sendStatus(404);

  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  const file = path.resolve(doc.source);

  // Defence in depth: the source came from our own library, but a poisoned
  // record must not be able to read outside the media directory.
  if (file !== dataDir && !file.startsWith(dataDir + path.sep)) {
    console.warn('media: refusing to serve outside DATA_DIR:', doc.source);
    return res.sendStatus(403);
  }

  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return res.sendStatus(404);
  }
  if (!stat.isFile()) return res.sendStatus(404);

  const type = doc.type || 'application/octet-stream';
  const etag = `"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;

  res.set({
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    // Keys are stable and content is immutable once written, but a regenerated
    // cutout reuses its key — so revalidate rather than cache blindly.
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  });

  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  const range = parseRange(req.headers.range, stat.size);

  if (range === 'invalid') {
    res.set('Content-Range', `bytes */${stat.size}`);
    return res.sendStatus(416);
  }

  if (!range) {
    res.set('Content-Length', String(stat.size));
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(res);
  }

  const { start, end } = range;
  res.status(206).set({
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Content-Length': String(end - start + 1),
  });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file, { start, end }).pipe(res);
}

/**
 * Parse a single byte range. Returns null for no range, 'invalid' for one that
 * cannot be satisfied, otherwise {start, end} inclusive.
 */
export function parseRange(header, size) {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return 'invalid';

  let start;
  let end;

  if (rawStart === '') {
    // Suffix form: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
    if (start >= size) return 'invalid';
    end = Math.min(end, size - 1);
  }

  if (start > end) return 'invalid';
  return { start, end };
}

/** The path the client should fetch for a document. */
export const mediaUrl = (key) => `/media/${encodeURIComponent(key)}`;

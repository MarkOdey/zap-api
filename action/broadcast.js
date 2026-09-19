import { Broadcast, current, maskTarget } from '../utils/broadcast.js';

/**
 * Start, stop, or report the live video broadcast.
 *
 * Not a queue job — it owns a long-lived encoder process — so it manages the
 * broadcast lifecycle directly. One broadcast at a time.
 *
 * The RTMP target may come from the environment (`RTMP_URL`, or `RTMP_INGEST` +
 * `RTMP_KEY`) or from params; the stream key is never echoed back or logged.
 *
 * @param {object}  params
 * @param {string} [params.op]   'start' | 'stop' | 'status' (default 'status')
 * @param {string} [params.url]  full RTMP ingest URL including key
 * @param {string} [params.key]  stream key, appended to RTMP_INGEST/params.ingest
 * @param {string} [params.ingest] RTMP ingest base, if key is given separately
 */
async function broadcast(params = {}) {
  const op = (typeof params === 'string' ? params : params?.op) || 'status';

  if (op === 'status') {
    const b = current();
    return b ? b.status() : { live: false };
  }

  if (op === 'stop') {
    const b = current();
    if (!b) return { live: false, stopped: false };
    await b.stop();
    console.log('broadcast: stopped');
    return { live: false, stopped: true };
  }

  if (op === 'start') {
    if (current()) throw new Error('broadcast: already live');
    const rtmpUrl = resolveTarget(params);
    // HLS-only (no RTMP) is allowed for local preview; warn so it is not a surprise.
    if (!rtmpUrl) console.warn('broadcast: no RTMP target — HLS preview only');
    const b = new Broadcast({ rtmpUrl });
    const status = await b.start();
    console.log('broadcast: started', maskTarget(rtmpUrl) ?? '(HLS only)');
    return status;
  }

  throw new Error(`broadcast: unknown op ${op}`);
}

/** Full URL from params/env, keeping the key out of anything returned. */
function resolveTarget({ url, key, ingest } = {}) {
  if (url) return url;
  if (process.env.RTMP_URL) return process.env.RTMP_URL;

  const base = ingest || process.env.RTMP_INGEST;
  const streamKey = key || process.env.RTMP_KEY;
  if (base && streamKey) return `${base.replace(/\/$/, '')}/${streamKey}`;

  return null;
}

export default broadcast;

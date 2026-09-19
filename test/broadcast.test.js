import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  maskTarget, normalizeArgs, fillerArgs, encoderArgs, Broadcast,
} from '../utils/broadcast.js';

describe('broadcast: stream-key masking', () => {
  it('hides the key at the end of the RTMP url', () => {
    const masked = maskTarget('rtmp://a.rtmp.youtube.com/live2/secret-key-123');
    assert.ok(!masked.includes('secret-key-123'), 'key must not appear');
    assert.ok(masked.startsWith('rtmp://a.rtmp.youtube.com/live2/'));
  });

  it('tolerates null / non-strings', () => {
    assert.equal(maskTarget(null), null);
    assert.equal(maskTarget(undefined), null);
  });
});

describe('broadcast: ffmpeg arg builders', () => {
  it('normalizes to canonical MPEG-TS on stdout, paced with -re', () => {
    const a = normalizeArgs('clip.mp4', { width: 1280, height: 720, fps: 30 });
    assert.ok(a.includes('-re'), 'paced to real time');
    assert.ok(a.join(' ').includes('scale=w=1280:h=720'), 'scaled to canonical size');
    assert.ok(a.join(' ').includes('pad=1280:720'), 'letter/pillar-boxed');
    assert.ok(a.includes('libx264') && a.includes('aac'), 'canonical codecs');
    assert.deepEqual(a.slice(-3), ['-f', 'mpegts', 'pipe:1']);
  });

  it('filler is a black frame plus silence', () => {
    const a = fillerArgs().join(' ');
    assert.ok(a.includes('color=c=black'), 'black video');
    assert.ok(a.includes('anullsrc'), 'silent audio');
    assert.ok(a.includes('mpegts'));
  });

  it('encoder relays to both RTMP and HLS, copying by default', () => {
    const a = encoderArgs({ rtmpUrl: 'rtmp://x/live/k', hlsDir: '/tmp/h' });
    const s = a.join(' ');
    assert.ok(s.includes('-f mpegts -i pipe:0'), 'reads TS from stdin');
    assert.ok(s.includes('-f flv rtmp://x/live/k'), 'RTMP output present');
    assert.ok(s.includes('-f hls'), 'HLS output present');
    assert.ok(s.includes('/tmp/h/live.m3u8'), 'HLS playlist path');
    assert.ok(s.includes('-c copy'), 'copies rather than re-encodes by default');
  });

  it('omits the RTMP output when there is no target (HLS-only preview)', () => {
    const s = encoderArgs({ rtmpUrl: null, hlsDir: '/tmp/h' }).join(' ');
    assert.ok(!s.includes('flv'), 'no RTMP output');
    assert.ok(s.includes('-f hls'), 'still serves HLS');
  });
});

describe('broadcast: lifecycle (fake ffmpeg)', () => {
  const fakeSpawn = (calls) => (bin, args) => {
    calls.push(args);
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stdin = new PassThrough();
    proc.kill = () => { proc.emit('close', 0); };
    // A source process ends on its own; the encoder stays open until killed.
    const isSource = args.includes('pipe:1');
    if (isSource) setImmediate(() => { proc.stdout.end(); proc.emit('close', 0); });
    return proc;
  };

  it('goes live, spawns an encoder and sources, then stops cleanly', async () => {
    const calls = [];
    const b = new Broadcast({
      rtmpUrl: 'rtmp://x/live/key',
      spawn: fakeSpawn(calls),
      probe: async () => ({ hasAudio: true }),
      hlsDir: '/tmp/zap-hls-test',
      // No DB: always fall to filler, which is enough to exercise the loop.
      select: async () => null,
    });

    const status = await b.start();
    assert.equal(status.live, true);
    assert.equal(status.target, maskTarget('rtmp://x/live/key'));

    // Let the feed loop turn a few times.
    await new Promise(r => setTimeout(r, 20));

    await b.stop();
    assert.equal(b.status().live, false);

    // The first spawn is the encoder (reads pipe:0); later ones are sources.
    assert.ok(calls[0].join(' ').includes('-i pipe:0'), 'encoder spawned first');
    assert.ok(calls.length >= 2, 'at least one source/filler was spawned');
  });

  it('skips a clip whose audio guard fails, even if selected', async () => {
    const calls = [];
    let served = 0;
    const b = new Broadcast({
      rtmpUrl: null,
      spawn: fakeSpawn(calls),
      // Report no audio, so the guard rejects the clip and filler runs instead.
      probe: async () => ({ hasAudio: false }),
      hlsDir: '/tmp/zap-hls-test2',
      select: async () => (served++ === 0 ? { key: 'v/1', source: 'v/1.mp4' } : null),
    });

    await b.start();
    await new Promise(r => setTimeout(r, 20));
    await b.stop();

    // currentKey never advanced to the guarded clip.
    assert.notEqual(b.status().currentKey, 'v/1');
  });
});

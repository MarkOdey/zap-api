import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { probeStreams, describeMedia } from '../utils/ffprobe.js';

// The ffprobe binary is spawned through an injectable `run`, so these exercise the
// parsing without needing ffprobe installed.
const withOutput = (json) => async () => (typeof json === 'string' ? json : JSON.stringify(json));

describe('ffprobe: probeStreams parsing', () => {
  it('reads duration, dimensions, and audio presence', async () => {
    const run = withOutput({
      format: { duration: '12.5' },
      streams: [
        { codec_type: 'video', width: 1920, height: 1080 },
        { codec_type: 'audio' },
      ],
    });
    assert.deepEqual(await probeStreams('x.mp4', { run }), {
      duration: 12.5,
      hasAudio: true,
      width: 1920,
      height: 1080,
    });
  });

  it('reports no audio when there is no audio stream', async () => {
    const run = withOutput({
      format: { duration: '4' },
      streams: [{ codec_type: 'video', width: 640, height: 480 }],
    });
    const { hasAudio } = await probeStreams('silent.mp4', { run });
    assert.equal(hasAudio, false);
  });

  it('falls back to safe defaults on unparseable output', async () => {
    const run = async () => 'not json';
    assert.deepEqual(await probeStreams('junk', { run }), {
      duration: null,
      hasAudio: false,
      width: null,
      height: null,
    });
  });
});

describe('ffprobe: describeMedia', () => {
  it('returns just the fields explore stores', async () => {
    const run = withOutput({
      format: { duration: '30' },
      streams: [
        { codec_type: 'video', width: 1280, height: 720 },
        { codec_type: 'audio' },
      ],
    });
    assert.deepEqual(await describeMedia('clip.mp4', { run }), {
      duration: 30,
      hasAudio: true,
      width: 1280,
      height: 720,
    });
  });
});

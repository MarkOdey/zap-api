import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

import { encodeDerived, OUTPUT_MAX_DIM, OUTPUT_FORMAT } from '../utils/vision.js';

let tmp;
before(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zap-encode-')); });
after(() => fs.rm(tmp, { recursive: true, force: true }));

/** A transparent-cornered RGBA image of the given size. */
async function rgba(width, height) {
  const px = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    px[i * 4] = i % 255;
    px[i * 4 + 1] = (i * 7) % 255;
    px[i * 4 + 2] = (i * 13) % 255;
    px[i * 4 + 3] = i < (width * height) / 2 ? 255 : 0;
  }
  return sharp(px, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe('encodeDerived', () => {
  it('caps the long edge at OUTPUT_MAX_DIM', async () => {
    const out = await encodeDerived(await rgba(4000, 2000));
    assert.equal(Math.max(out.width, out.height), OUTPUT_MAX_DIM);
  });

  it('preserves aspect ratio when capping', async () => {
    const out = await encodeDerived(await rgba(4000, 1000));
    assert.equal(out.width / out.height, 4);
  });

  it('does not upscale a small image', async () => {
    const out = await encodeDerived(await rgba(320, 240));
    assert.equal(out.width, 320);
    assert.equal(out.height, 240);
  });

  it('keeps the alpha channel — cutouts are transparent by definition', async () => {
    const out = await encodeDerived(await rgba(600, 400));
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.hasAlpha, true, 'transparency must survive encoding');
    assert.equal(meta.channels, 4);
  });

  it('keeps transparent regions transparent', async () => {
    const out = await encodeDerived(await rgba(400, 400));
    const { data, info } = await sharp(out.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
    assert.ok(alphaAt(10, 10) > 200, 'opaque half stays opaque');
    assert.ok(alphaAt(10, info.height - 10) < 55, 'transparent half stays transparent');
  });

  it('reports a matching extension and MIME type', async () => {
    const out = await encodeDerived(await rgba(100, 100));
    assert.equal(out.ext, OUTPUT_FORMAT);
    assert.equal(out.mime, `image/${OUTPUT_FORMAT}`);
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.format, OUTPUT_FORMAT);
  });

  // Regression: a full-resolution lossless PNG cutout came out at 15MB — larger
  // than the JPEG it was cut from — because a 93%-coverage mask left trim()
  // nothing to crop. The guarantee is an absolute ceiling, not a ratio: how well
  // an image compresses depends on its content, and a synthetic high-frequency
  // pattern is the worst case for lossy encoding while being the best case for PNG.
  it('holds a large cutout under a fixed ceiling', async () => {
    const out = await encodeDerived(await rgba(4000, 3000));
    assert.equal(Math.max(out.width, out.height), OUTPUT_MAX_DIM, 'must be capped');
    assert.ok(out.buffer.length < 2_000_000,
      `a capped cutout should stay under 2MB, got ${(out.buffer.length / 1048576).toFixed(2)}MB`);
  });

  it('compresses photographic content hard', async () => {
    // Smooth gradients behave like a photo, unlike the noise fixture above.
    const w = 3000, h = 2000;
    const px = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        px[i] = (x / w) * 255;
        px[i + 1] = (y / h) * 255;
        px[i + 2] = ((x + y) / (w + h)) * 255;
        px[i + 3] = 255;
      }
    }
    const png = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const out = await encodeDerived(png);
    assert.ok(out.buffer.length < png.length / 4,
      `expected a large reduction on photo-like content, got ${out.buffer.length} from ${png.length}`);
  });
});

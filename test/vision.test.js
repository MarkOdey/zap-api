import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

import { loadForInference, cutOut, maskCoverage, INFERENCE_MAX_DIM } from '../utils/vision.js';
import { isDerivative, derivationDepth } from '../model/document.js';
import isolate from '../action/isolate.js';
import compose from '../action/compose.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zap-vision-'));
after(() => fs.rm(tmp, { recursive: true, force: true }));

/** A solid image with the given EXIF orientation baked in. */
async function makeImage(name, width, height, orientation = 1) {
  const file = path.join(tmp, name);
  await sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .withMetadata({ orientation })
    .jpeg()
    .toFile(file);
  return file;
}

/** A fake model mask: left half on, right half off. */
function halfMask(width, height) {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = x < width / 2 ? 255 : 0;
  }
  return { data, width, height, channels: 1 };
}

describe('vision: maskCoverage', () => {
  it('measures the fraction of the mask that is set', () => {
    assert.equal(maskCoverage(halfMask(100, 100)), 0.5);
  });

  it('handles all-on and all-off masks', () => {
    const w = 10, h = 10;
    assert.equal(maskCoverage({ data: new Uint8ClampedArray(w * h).fill(255), width: w, height: h }), 1);
    assert.equal(maskCoverage({ data: new Uint8ClampedArray(w * h).fill(0), width: w, height: h }), 0);
  });
});

describe('vision: loadForInference', () => {
  it('downscales the long edge to the inference limit', async () => {
    const file = await makeImage('big.jpg', 4000, 2000);
    const { raw, width, height } = await loadForInference(file);
    assert.equal(width, 4000);
    assert.equal(height, 2000);
    assert.equal(Math.max(raw.width, raw.height), INFERENCE_MAX_DIM);
    assert.equal(raw.channels, 3);
  });

  it('does not upscale an image smaller than the limit', async () => {
    const file = await makeImage('small.jpg', 200, 100);
    const { raw } = await loadForInference(file);
    assert.equal(raw.width, 200);
    assert.equal(raw.height, 100);
  });

  it('preserves aspect ratio when downscaling', async () => {
    const file = await makeImage('wide.jpg', 4000, 1000);
    const { raw } = await loadForInference(file);
    assert.equal(raw.width / raw.height, 4);
  });

  // Regression: metadata() reports pre-rotation dimensions. Orientations 5-8
  // rotate by 90°, so reported and actual dimensions are swapped, and the mask
  // then has the wrong shape — sharp rejects it as "must have same dimensions".
  for (const orientation of [5, 6, 7, 8]) {
    it(`reports post-rotation dimensions for EXIF orientation ${orientation}`, async () => {
      const file = await makeImage(`rot${orientation}.jpg`, 400, 200, orientation);
      const { width, height } = await loadForInference(file);
      assert.equal(width, 200, 'width should be the rotated width');
      assert.equal(height, 400, 'height should be the rotated height');
    });
  }

  for (const orientation of [1, 2, 3, 4]) {
    it(`leaves dimensions alone for EXIF orientation ${orientation}`, async () => {
      const file = await makeImage(`norot${orientation}.jpg`, 400, 200, orientation);
      const { width, height } = await loadForInference(file);
      assert.equal(width, 400);
      assert.equal(height, 200);
    });
  }
});

describe('vision: cutOut', () => {
  it('writes the mask into the alpha channel', async () => {
    const file = await makeImage('cut.jpg', 100, 100);
    const { image, width, height } = await loadForInference(file);
    const png = await cutOut(image, halfMask(50, 50), width, height);

    const meta = await sharp(png).metadata();
    assert.equal(meta.channels, 4, 'result should carry an alpha channel');
    assert.equal(meta.width, 100);
    assert.equal(meta.height, 100);

    const stats = await sharp(png).stats();
    const alphaMean = stats.channels[3].mean;
    assert.ok(alphaMean > 100 && alphaMean < 155, `half-masked alpha should be ~127, got ${alphaMean}`);
  });

  // Regression: sharp's dest-in blend keys off the overlay's alpha, so a
  // greyscale mask with no alpha silently kept the entire image.
  it('actually removes the masked-out region', async () => {
    const file = await makeImage('cut2.jpg', 100, 100);
    const { image, width, height } = await loadForInference(file);
    const png = await cutOut(image, halfMask(100, 100), width, height);

    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * 100 + x) * 4 + 3];
    assert.equal(alphaAt(10, 50), 255, 'left half should be kept');
    assert.equal(alphaAt(90, 50), 0, 'right half should be transparent');
  });

  it('upscales a mask smaller than the image', async () => {
    const file = await makeImage('cut3.jpg', 400, 400);
    const { image, width, height } = await loadForInference(file);
    const png = await cutOut(image, halfMask(40, 40), width, height);
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 400);
    assert.equal(meta.height, 400);
  });
});

describe('model: derivation helpers', () => {
  it('recognises a generated document', () => {
    assert.equal(isDerivative({ generator: 'isolate' }), true);
    assert.equal(isDerivative({ generator: '' }), false);
    assert.equal(isDerivative({}), false);
    assert.equal(isDerivative(null), false);
  });

  it('counts derivation depth from derivedFrom', () => {
    assert.equal(derivationDepth({ derivedFrom: ['a'] }), 1);
    assert.equal(derivationDepth({ derivedFrom: ['a', 'b'] }), 2);
    assert.equal(derivationDepth({}), 0);
    assert.equal(derivationDepth({ derivedFrom: 'not-an-array' }), 0);
  });
});

// These reject before any database or model is touched.
describe('vision actions: argument validation', () => {
  it('isolate requires a key', async () => {
    await assert.rejects(() => isolate({}), /key is required/);
    await assert.rejects(() => isolate(), /key is required/);
  });

  it('compose requires both from and to', async () => {
    await assert.rejects(() => compose({ from: 'a' }), /both from and to are required/);
    await assert.rejects(() => compose({ to: 'b' }), /both from and to are required/);
    await assert.rejects(() => compose(), /both from and to are required/);
  });
});

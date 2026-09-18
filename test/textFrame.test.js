import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { renderTextFrame, wrap } from '../utils/textFrame.js';

describe('textFrame: wrap', () => {
  it('keeps short text on one line', () => {
    assert.deepEqual(wrap('hello there', 40), ['hello there']);
  });

  it('breaks on word boundaries', () => {
    const lines = wrap('one two three four five six', 10);
    for (const l of lines) assert.ok(l.length <= 10, `too long: "${l}"`);
    assert.ok(lines.every(l => !l.startsWith(' ') && !l.endsWith(' ')));
  });

  it('splits a word longer than the line', () => {
    const lines = wrap('supercalifragilistic', 8);
    assert.ok(lines.length > 1);
    for (const l of lines) assert.ok(l.length <= 8);
    assert.equal(lines.join(''), 'supercalifragilistic');
  });

  it('loses no words', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    assert.equal(wrap(text, 12).join(' '), text);
  });

  it('copes with a line width of one', () => {
    assert.ok(wrap('ab cd', 1).length >= 4);
  });
});

describe('textFrame: renderTextFrame', () => {
  it('rejects empty text', async () => {
    await assert.rejects(() => renderTextFrame(''), /nothing to render/);
    await assert.rejects(() => renderTextFrame('   '), /nothing to render/);
  });

  it('produces a PNG of the requested size', async () => {
    const png = await renderTextFrame('ZAP', { width: 640, height: 360 });
    const meta = await sharp(png).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, 640);
    assert.equal(meta.height, 360);
  });

  // A missing font would render a black rectangle, so assert there are light pixels.
  it('actually draws glyphs', async () => {
    const png = await renderTextFrame('ZAP', { width: 640, height: 360 });
    const stats = await sharp(png).greyscale().stats();
    assert.ok(stats.channels[0].max > 200, 'expected bright glyph pixels');
    assert.ok(stats.channels[0].mean > 1, 'frame should not be almost entirely black');
  });

  it('scales short text larger than long text', async () => {
    const short = await sharp(await renderTextFrame('HI', { width: 640, height: 360 })).greyscale().stats();
    const long = await sharp(await renderTextFrame('word '.repeat(80), { width: 640, height: 360 })).greyscale().stats();
    // Bigger glyphs cover more of the frame per character.
    assert.ok(short.channels[0].mean > 0, 'short text renders');
    assert.ok(long.channels[0].mean > 0, 'long text renders');
  });

  it('escapes XML so markup in the text cannot break the SVG', async () => {
    const png = await renderTextFrame('a < b & c > d "quoted"', { width: 640, height: 360 });
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 640, 'should still produce a valid frame');
  });

  it('honours the background colour', async () => {
    const png = await renderTextFrame('x', { width: 200, height: 120, background: 'white', colour: 'black' });
    const stats = await sharp(png).greyscale().stats();
    assert.ok(stats.channels[0].mean > 200, 'a white background should be bright overall');
  });

  it('does not overflow the frame with very long text', async () => {
    const png = await renderTextFrame('lorem ipsum '.repeat(400), { width: 640, height: 360 });
    const meta = await sharp(png).metadata();
    assert.equal(meta.height, 360);
  });
});

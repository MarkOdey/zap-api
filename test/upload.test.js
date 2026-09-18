import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { writePayload } from '../action/upload.js';

let dir;
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zap-upload-')); });
after(() => fs.rm(dir, { recursive: true, force: true }));

const target = (name) => path.join(dir, name);

describe('upload: writePayload', () => {
  // Regression: every payload was treated as base64, so text typed into the box was
  // base64-*decoded* — "Hello there" became 7 bytes of binary that rendered as garbage.
  it('writes plain text as text', async () => {
    const file = target('plain.txt');
    await writePayload(file, 'Hello there');
    assert.equal(await fs.readFile(file, 'utf8'), 'Hello there');
  });

  it('preserves multi-line text and unicode', async () => {
    const file = target('unicode.txt');
    const text = 'first line\nsecond — é ü 日本語\n';
    await writePayload(file, text);
    assert.equal(await fs.readFile(file, 'utf8'), text);
  });

  it('decodes a base64 data URL', async () => {
    const file = target('from-b64.bin');
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    await writePayload(file, `data:application/octet-stream;base64,${bytes.toString('base64')}`);
    assert.ok((await fs.readFile(file)).equals(bytes));
  });

  it('decodes a percent-encoded data URL', async () => {
    const file = target('from-pct.txt');
    await writePayload(file, 'data:text/plain,Hello%20there%21');
    assert.equal(await fs.readFile(file, 'utf8'), 'Hello there!');
  });

  it('does not mistake text merely containing "data:" for a data URL', async () => {
    const file = target('mentions.txt');
    const text = 'see data:text/plain for the format';
    await writePayload(file, text);
    assert.equal(await fs.readFile(file, 'utf8'), text);
  });

  it('round-trips a real image through a data URL', async () => {
    const file = target('pixel.png');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await writePayload(file, `data:image/png;base64,${png.toString('base64')}`);
    assert.ok((await fs.readFile(file)).equals(png));
  });

  it('rejects a malformed data URL rather than writing nonsense', async () => {
    await assert.rejects(() => writePayload(target('bad'), 'data:image/png;base64'), /malformed data URL/);
  });

  it('rejects a non-string payload', async () => {
    await assert.rejects(() => writePayload(target('x'), null), /must be a string/);
    await assert.rejects(() => writePayload(target('x'), 42), /must be a string/);
  });

  it('writes an empty string as an empty file, not garbage', async () => {
    const file = target('empty.txt');
    await writePayload(file, '');
    assert.equal((await fs.stat(file)).size, 0);
  });
});

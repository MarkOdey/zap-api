import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { chunkText, CHUNK_CHARS } from '../utils/speech.js';
import speak from '../action/speak.js';

describe('speech: chunkText', () => {
  it('returns nothing for empty input', () => {
    assert.deepEqual(chunkText(''), []);
    assert.deepEqual(chunkText('   \n  '), []);
  });

  it('leaves short text in one piece', () => {
    assert.deepEqual(chunkText('Hello there.'), ['Hello there.']);
  });

  it('collapses whitespace', () => {
    assert.deepEqual(chunkText('a\n\n  b   c'), ['a b c']);
  });

  it('splits long text on sentence boundaries', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const chunks = chunkText(sentence.repeat(12), 200);
    assert.ok(chunks.length > 1, 'should split');
    for (const c of chunks) assert.ok(c.length <= 200, `chunk too long: ${c.length}`);
    // Sentences must not be cut mid-way.
    for (const c of chunks) assert.ok(/[.!?]$/.test(c.trim()), `chunk does not end a sentence: "${c.slice(-30)}"`);
  });

  it('falls back to word boundaries for a sentence longer than the limit', () => {
    const long = `${'word '.repeat(120)}.`;
    const chunks = chunkText(long, 100);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 100, `chunk too long: ${c.length}`);
  });

  it('never loses or duplicates words', () => {
    const text = 'Alpha beta. Gamma delta epsilon. Zeta eta theta iota. Kappa lambda.';
    const joined = chunkText(text, 25).join(' ').replace(/\s+/g, ' ').trim();
    assert.deepEqual(joined.split(' ').sort(), text.replace(/\s+/g, ' ').trim().split(' ').sort());
  });

  it('handles text with no sentence punctuation at all', () => {
    const chunks = chunkText('a '.repeat(300), 80);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 80);
  });

  it('uses a sane default limit', () => {
    assert.ok(CHUNK_CHARS > 0 && CHUNK_CHARS <= 1000);
  });
});

// These reject before a model loads or a database is touched.
describe('speak: validation', () => {
  it('requires a key', async () => {
    await assert.rejects(() => speak({}), /key is required/);
    await assert.rejects(() => speak(), /key is required/);
  });
});

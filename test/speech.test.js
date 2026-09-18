import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { chunkText, normaliseForSpeech, CHUNK_CHARS } from '../utils/speech.js';
import speak from '../action/speak.js';

// A speech model reads characters. Round-tripped through recognition, an
// unnormalised feed item came back as "article Earl Hapsil, Corey's uning daily
// calm museness" — the arrhythmic delivery was it sounding out character soup.
describe('speech: normaliseForSpeech', () => {
  it('removes addresses', () => {
    assert.equal(normaliseForSpeech('See https://example.com/a/b?c=1 now.'), 'See now.');
    assert.equal(normaliseForSpeech('Visit www.example.com today'), 'Visit today');
    assert.equal(normaliseForSpeech('Mail a@b.com please'), 'Mail please');
  });

  it('removes bare domains, which are read letter by letter', () => {
    assert.ok(!normaliseForSpeech('Read arxiv.org/abs/2609 for more').includes('arxiv'));
  });

  it('removes syndication boilerplate', () => {
    const out = normaliseForSpeech('Headline. Article URL: https://x.com/y Comments URL: https://n.com/z Points: 165 # Comments: 46');
    assert.equal(out, 'Headline.');
  });

  it('says symbols that have a spoken form', () => {
    assert.match(normaliseForSpeech('up 10% today'), /10 percent/);
    assert.match(normaliseForSpeech('this & that'), /this and that/);
    assert.match(normaliseForSpeech('Ruby vs. Python'), /versus/);
  });

  it('drops marks that have no spoken form', () => {
    const out = normaliseForSpeech('a [b] {c} <d> |e| ~f~ ^g^');
    for (const ch of '[]{}<>|~^') assert.ok(!out.includes(ch), `${ch} should be gone`);
  });

  it('leaves ordinary prose alone but for spacing', () => {
    assert.equal(normaliseForSpeech('A normal sentence, with punctuation.'),
      'A normal sentence, with punctuation.');
  });

  it('does not leave a space before punctuation after removing something', () => {
    assert.equal(normaliseForSpeech('Read https://x.com/y.'), 'Read.');
  });

  it('copes with empty and missing input', () => {
    assert.equal(normaliseForSpeech(''), '');
    assert.equal(normaliseForSpeech(null), '');
    assert.equal(normaliseForSpeech(undefined), '');
  });

  it('leaves nothing to say when an item is only a link', () => {
    assert.equal(normaliseForSpeech('https://example.com/only'), '');
  });
});

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
    await assert.rejects(() => speak({}), /key must be a text document/);
    await assert.rejects(() => speak(), /key must be a text document/);
  });

  // A bare `--key` flag parses to boolean true, which used to pass a truthiness
  // check and fail confusingly deeper in, inside find.
  it('rejects a key that is not a string', async () => {
    for (const bad of [true, 42, {}, '', '   ']) {
      await assert.rejects(() => speak({ key: bad }), /key must be a text document/,
        `${JSON.stringify(bad)} should be rejected by speak itself`);
    }
  });
});

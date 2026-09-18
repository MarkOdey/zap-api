import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MIN_INPUT_CHARS, MAX_TOKENS, SUMMARY_MODEL } from '../utils/summary.js';
import summarize from '../action/summarize.js';

describe('summary: configuration', () => {
  it('uses a small model, not a large one', () => {
    assert.match(SUMMARY_MODEL, /distilbart|t5|bart/i);
  });

  it('caps output to roughly a sentence or two', () => {
    assert.ok(MAX_TOKENS > 0 && MAX_TOKENS <= 120, `${MAX_TOKENS} tokens is not a summary`);
  });

  it('has a floor below which there is nothing to condense', () => {
    assert.ok(MIN_INPUT_CHARS > 0);
  });
});

// These reject before a model loads or a database is touched.
describe('summarize: validation', () => {
  it('requires a key, and a string one', async () => {
    await assert.rejects(() => summarize({}), /key must be a text document key/);
    await assert.rejects(() => summarize({ key: true }), /key must be a text document key/);
    await assert.rejects(() => summarize({ key: '   ' }), /key must be a text document key/);
    await assert.rejects(() => summarize(), /key must be a text document key/);
  });
});

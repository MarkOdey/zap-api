import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { tally, steeringTerms } from '../utils/vocabulary.js';

describe('vocabulary: tally', () => {
  it('counts subjects and labels, keeping max coverage', () => {
    const terms = tally([
      { subjects: [{ label: 'dog', coverage: 0.5 }, { label: 'grass', coverage: 0.2 }] },
      { labels: ['dog', 'cat'] },
      { subjects: [{ label: 'dog', coverage: 0.8 }] },
    ]);
    const map = Object.fromEntries(terms.map(t => [t.label, t]));
    assert.equal(map.dog.freq, 3);
    assert.equal(map.dog.coverage, 0.8);
    assert.equal(map.cat.freq, 1);
  });

  it('drops meaningless stop-ish labels', () => {
    const terms = tally([{ labels: ['thing', 'background', 'bicycle'] }]);
    assert.deepEqual(terms.map(t => t.label), ['bicycle']);
  });
});

describe('vocabulary: steeringTerms', () => {
  it('returns up to n labels from the vocabulary', () => {
    const vocab = [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }];
    const terms = steeringTerms(vocab, 2, () => 0.5);
    assert.equal(terms.length, 2);
    terms.forEach(t => assert.ok(['a', 'b', 'c', 'd'].includes(t)));
  });
  it('is empty for an empty vocabulary', () => {
    assert.deepEqual(steeringTerms([]), []);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { windows, weightPlays } from '../utils/recurrence.js';

const DAY = 86_400_000;

describe('recurrence: windows', () => {
  it('weights yesterday highest and last-year lowest', () => {
    const w = windows(new Date());
    const byName = Object.fromEntries(w.map(x => [x.name, x.weight]));
    assert.ok(byName['yesterday'] > byName['last-week']);
    assert.ok(byName['last-week'] > byName['last-year']);
  });
});

describe('recurrence: weightPlays', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0);

  it('scores terms by window weight and enjoyment, ignoring plays outside any window', () => {
    const plays = [
      { terms: ['dog'], resolved: true, at: new Date(now.getTime() - DAY) },        // yesterday, enjoyed: 3*2
      { terms: ['cat'], resolved: false, at: new Date(now.getTime() - 7 * DAY) },   // last week, skipped: 2*1
      { terms: ['fish'], resolved: true, at: new Date(now.getTime() - 3 * DAY) },   // no window → ignored
    ];
    const scores = weightPlays(plays, now);
    const map = Object.fromEntries(scores.map(s => [s.label, s.score]));
    assert.equal(map.dog, 6);
    assert.equal(map.cat, 2);
    assert.ok(!('fish' in map), 'plays outside any analogous window are ignored');
    assert.equal(scores[0].label, 'dog', 'strongest first');
  });

  it('accumulates across plays and handles numeric timestamps', () => {
    const plays = [
      { terms: ['sky'], resolved: true, at: now.getTime() - DAY },
      { terms: ['sky'], resolved: false, at: now.getTime() - DAY },
    ];
    const [top] = weightPlays(plays, now);
    assert.equal(top.label, 'sky');
    assert.equal(top.score, 3 * 2 + 3 * 1);
  });
});

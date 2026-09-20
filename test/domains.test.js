import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pickDomain, weightedPick, DEFAULT_DOMAINS } from '../missions/domains.js';

describe('domains: weightedPick', () => {
  it('returns null for an empty set', () => {
    assert.equal(weightedPick({}), null);
  });
  it('is deterministic with a fixed rand', () => {
    assert.equal(weightedPick({ a: 1, b: 1 }, () => 0), 'a');
    assert.equal(weightedPick({ a: 1, b: 1 }, () => 0.99), 'b');
  });
});

describe('domains: pickDomain', () => {
  const evening = { timeOfDay: 'evening', nearbyHolidays: [] };

  it('pre-empts with seasonal near a holiday', () => {
    const cal = { timeOfDay: 'afternoon', nearbyHolidays: [{ name: 'Halloween', daysAway: 0 }] };
    assert.equal(pickDomain(cal), 'seasonal');
  });

  it('draws from the hour band otherwise', () => {
    const d = pickDomain(evening, { rand: () => 0 });
    assert.ok(['philosophy', 'literature', 'love', 'music', 'culture'].includes(d));
  });

  it('never returns a disabled domain', () => {
    const domains = DEFAULT_DOMAINS.filter(x => x !== 'philosophy' && x !== 'religion' && x !== 'controversial');
    for (let i = 0; i < 20; i++) {
      const d = pickDomain({ timeOfDay: 'night', nearbyHolidays: [] }, { domains, rand: Math.random });
      assert.ok(domains.includes(d), `got disabled domain ${d}`);
    }
  });

  it('falls back to any enabled domain for an unknown band', () => {
    const d = pickDomain({ timeOfDay: 'nonesuch', nearbyHolidays: [] }, { domains: ['art'], rand: () => 0 });
    assert.equal(d, 'art');
  });
});

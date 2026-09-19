import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeCalendar, describeCalendar } from '../utils/calendar.js';

describe('calendar: computeCalendar', () => {
  it('reads season, time-of-day, and a near holiday (Halloween evening)', () => {
    const cal = computeCalendar(new Date(2026, 9, 31, 20, 0, 0)); // Oct 31, 8pm
    assert.equal(cal.season, 'autumn');
    assert.equal(cal.timeOfDay, 'evening');
    const halloween = cal.nearbyHolidays.find(h => h.name === 'Halloween');
    assert.ok(halloween, 'Halloween should be near');
    assert.equal(halloween.daysAway, 0);
  });

  it('classifies the four time bands', () => {
    assert.equal(computeCalendar(new Date(2026, 5, 1, 8)).timeOfDay, 'morning');
    assert.equal(computeCalendar(new Date(2026, 5, 1, 14)).timeOfDay, 'afternoon');
    assert.equal(computeCalendar(new Date(2026, 5, 1, 19)).timeOfDay, 'evening');
    assert.equal(computeCalendar(new Date(2026, 5, 1, 2)).timeOfDay, 'night');
  });

  it('has no near holiday on an ordinary day', () => {
    const cal = computeCalendar(new Date(2026, 6, 10, 12)); // mid-July
    assert.equal(cal.nearbyHolidays.length, 0);
    assert.equal(cal.season, 'summer');
  });

  it('describes itself for the LLM', () => {
    const s = describeCalendar(computeCalendar(new Date(2026, 9, 31, 20)));
    assert.match(s, /Halloween/);
  });
});

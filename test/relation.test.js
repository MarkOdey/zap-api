import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import TYPES from '../relation/statement.js';

describe('relation: statement types', () => {
  it('exposes the edge types cognition/relate.js draws from', () => {
    assert.deepEqual(Object.keys(TYPES).sort(),
      ['FAMILY', 'LOCATION', 'SYNTACTIC_ROLE', 'TEMPORAL', 'THEME']);
  });

  it('values are the strings written to the edges collection', () => {
    assert.equal(TYPES.THEME, 'theme');
    assert.equal(TYPES.SYNTACTIC_ROLE, 'syntactic_role');
    assert.ok(Object.values(TYPES).every(v => typeof v === 'string' && v === v.toLowerCase()));
  });
});

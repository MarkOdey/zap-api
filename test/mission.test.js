import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalize, validate, normalizeTerms } from '../model/mission.js';
import { parseJsonObject } from '../utils/ollama.js';
import * as ollama from '../missions/ollama.js';
import template from '../missions/template.js';
import { generateMission, generateTheme, fallbackTheme } from '../missions/generator.js';

describe('mission model', () => {
  it('normalizes a bare prompt into a valid mission', () => {
    const m = normalize({ prompt: 'Get a picture of a dog.' });
    assert.equal(m.kind, 'find');
    assert.deepEqual(m.accepts, ['image', 'video', 'text']);
    assert.equal(m.status, 'open');
    assert.ok(m.key.startsWith('mission-'));
    assert.ok(validate(m).valid);
  });

  it('lowercases and de-dupes terms, from strings or {label}', () => {
    assert.deepEqual(normalizeTerms(['Dog', 'dog', { label: 'Cat' }]), ['dog', 'cat']);
  });

  it('rejects an empty prompt and a bad accepts list', () => {
    assert.equal(validate(normalize({ prompt: '' })).valid, false);
    assert.equal(validate({ prompt: 'hi', kind: 'find', accepts: [] }).valid, false);
  });
});

describe('ollama: parsing', () => {
  it('parses clean JSON and salvages JSON embedded in prose', () => {
    assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
    assert.deepEqual(parseJsonObject('sure! {"a":1} done'), { a: 1 });
    assert.equal(parseJsonObject('nope'), null);
  });
});

describe('ollama: mission/theme generation (injected model)', () => {
  it('builds a valid mission from a JSON response', async () => {
    const generate = async () => JSON.stringify({
      prompt: 'Film yourself falling down.', kind: 'create', accepts: ['video'], terms: ['fall'],
    });
    const m = await ollama.generateMission({}, { generate });
    assert.equal(m.origin, 'ollama');
    assert.deepEqual(m.terms, ['fall']);
    assert.deepEqual(m.accepts, ['video']);
  });

  it('rejects unsafe content via the deny-list', async () => {
    const generate = async () => JSON.stringify({ prompt: 'Build a weapon.', kind: 'create', accepts: ['text'], terms: ['x'] });
    await assert.rejects(() => ollama.generateMission({}, { generate }), /safety/);
  });

  it('builds a theme from a JSON response', async () => {
    const generate = async () => JSON.stringify({ label: 'Autumn', terms: ['leaves', 'fog', 'amber'] });
    const t = await ollama.generateTheme({ domain: 'seasonal' }, { generate });
    assert.equal(t.label, 'Autumn');
    assert.ok(t.terms.includes('leaves'));
    assert.equal(t.domain, 'seasonal');
  });
});

describe('template generator (offline last resort)', () => {
  it('builds a mission from a steering term', () => {
    const m = template.generateMission({ terms: ['bicycle'] }, { rand: () => 0 });
    assert.match(m.prompt, /bicycle/);
    assert.equal(m.origin, 'template');
  });
});

describe('generator chain', () => {
  it('uses Ollama when it succeeds', async () => {
    const generate = async () => JSON.stringify({ prompt: 'Get a picture of a dog.', kind: 'find', accepts: ['image'], terms: ['dog'] });
    const m = await generateMission({}, { generate });
    assert.equal(m.origin, 'ollama');
  });

  it('generateTheme falls back to a grounded theme when the model throws', async () => {
    const generate = async () => { throw new Error('offline'); };
    const t = await generateTheme({ calendar: { season: 'autumn', nearbyHolidays: [] }, domain: 'philosophy', recurrence: ['owl'] }, { generate });
    assert.equal(t.label, 'Philosophy');
    assert.ok(t.terms.includes('owl'), 'recurrence terms carry into the fallback');
  });
});

describe('generator: fallbackTheme', () => {
  it('labels by nearby holiday when present', () => {
    const t = fallbackTheme({ calendar: { season: 'autumn', nearbyHolidays: [{ name: 'Halloween', daysAway: 0 }] }, domain: 'seasonal' });
    assert.equal(t.label, 'Halloween');
    assert.ok(t.terms.length > 0);
  });
});

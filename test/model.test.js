import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FIELDS, REQUIRED, validate, normalize, mediaKind } from '../model/document.js';

const validDoc = {
  key: 'data/clip.mp4',
  source: 'data/clip.mp4',
  name: 'clip.mp4',
  type: 'video/mp4',
  weight: 0.5,
};

describe('model: validate', () => {
  it('accepts a conforming document', () => {
    assert.deepEqual(validate(validDoc), { valid: true, errors: [] });
  });

  it('allows extra fields by default (exiftool merges arbitrary keys)', () => {
    const { valid } = validate({ ...validDoc, ImageWidth: 1920, Duration: 12 });
    assert.equal(valid, true);
  });

  it('rejects extra fields under strict', () => {
    const { valid, errors } = validate({ ...validDoc, ImageWidth: 1920 }, { strict: true });
    assert.equal(valid, false);
    assert.ok(errors.some(e => e.includes('unknown field: ImageWidth')));
  });

  it('ignores _id under strict, since Mongo adds it', () => {
    const { valid } = validate({ ...validDoc, _id: 'abc' }, { strict: true });
    assert.equal(valid, true);
  });

  for (const field of REQUIRED) {
    it(`rejects a document missing ${field}`, () => {
      const doc = { ...validDoc };
      delete doc[field];
      const { valid, errors } = validate(doc);
      assert.equal(valid, false);
      assert.ok(errors.some(e => e.includes(`missing required field: ${field}`)));
    });
  }

  it('rejects wrong types', () => {
    const { valid, errors } = validate({ ...validDoc, weight: '0.5' });
    assert.equal(valid, false);
    assert.ok(errors.some(e => e.includes('weight must be a number')));
  });

  it('rejects empty strings', () => {
    const { valid, errors } = validate({ ...validDoc, name: '   ' });
    assert.equal(valid, false);
    assert.ok(errors.some(e => e.includes('name must not be empty')));
  });

  it('rejects weight outside 0–1', () => {
    assert.equal(validate({ ...validDoc, weight: 1.5 }).valid, false);
    assert.equal(validate({ ...validDoc, weight: -0.1 }).valid, false);
    assert.equal(validate({ ...validDoc, weight: NaN }).valid, false);
  });

  it('accepts the 0 and 1 boundaries', () => {
    assert.equal(validate({ ...validDoc, weight: 0 }).valid, true);
    assert.equal(validate({ ...validDoc, weight: 1 }).valid, true);
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 'string', 42, []]) {
      assert.equal(validate(bad).valid, false, `expected ${JSON.stringify(bad)} to be invalid`);
    }
  });

  it('reports every problem at once, not just the first', () => {
    const { errors } = validate({ key: 'k' });
    assert.equal(errors.length, 4); // source, name, type, weight
  });
});

describe('model: normalize', () => {
  it('derives key, name, type and weight from source alone', () => {
    const doc = normalize({ source: 'data/photo.jpg' });
    assert.equal(doc.key, 'data/photo.jpg');
    assert.equal(doc.name, 'photo.jpg');
    assert.equal(doc.type, 'image/jpeg');
    assert.equal(typeof doc.weight, 'number');
    assert.equal(validate(doc).valid, true);
  });

  it('derives source from key', () => {
    assert.equal(normalize({ key: 'data/a.mp4' }).source, 'data/a.mp4');
  });

  it('does not overwrite values that were supplied', () => {
    const doc = normalize({ source: 'data/a.mp4', name: 'custom', type: 'video/webm', weight: 0.25 });
    assert.equal(doc.name, 'custom');
    assert.equal(doc.type, 'video/webm');
    assert.equal(doc.weight, 0.25);
  });

  it('keeps weight 0, which is falsy but valid', () => {
    assert.equal(normalize({ source: 'data/a.mp4', weight: 0 }).weight, 0);
  });

  it('produces an empty type for an unknown extension, not undefined', () => {
    assert.equal(normalize({ source: 'data/file.xyzzy' }).type, '');
  });

  it('does not invent a key when there is nothing to derive it from', () => {
    assert.equal(normalize({}).key, undefined);
  });

  it('leaves the input object untouched', () => {
    const input = { source: 'data/a.mp4' };
    normalize(input);
    assert.deepEqual(input, { source: 'data/a.mp4' });
  });
});

describe('model: mediaKind', () => {
  it('maps MIME types to player kinds', () => {
    assert.equal(mediaKind({ type: 'video/mp4' }), 'video');
    assert.equal(mediaKind({ type: 'image/jpeg' }), 'image');
    assert.equal(mediaKind({ type: 'audio/mpeg' }), 'audio');
    assert.equal(mediaKind({ type: 'text/plain' }), 'text');
  });

  it('returns null for unknown, empty or absent types', () => {
    assert.equal(mediaKind({ type: 'application/pdf' }), null);
    assert.equal(mediaKind({ type: '' }), null);
    assert.equal(mediaKind({}), null);
    assert.equal(mediaKind(null), null);
  });
});

describe('model: FIELDS', () => {
  it('documents every required field', () => {
    assert.deepEqual(REQUIRED, ['key', 'source', 'name', 'type', 'weight']);
    for (const [name, spec] of Object.entries(FIELDS)) {
      assert.ok(spec.desc, `${name} should carry a description`);
    }
  });
});

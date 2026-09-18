import mime from 'mime';

/**
 * Canonical shape of a document in the `data` collection.
 *
 * This is the contract every writer must satisfy (explore, record, upload) and
 * every reader may rely on (play, find, list, the client's media store). Extra
 * fields are permitted unless `strict` is set, so a writer can attach its own
 * metadata without every reader having to know about it.
 */
export const FIELDS = {
  key:    { type: 'string', required: true,  desc: 'Unique identifier; currently the file path' },
  source: { type: 'string', required: true,  desc: 'Path to the file on disk' },
  name:   { type: 'string', required: true,  desc: 'Filename only' },
  type:   { type: 'string', required: true,  desc: 'MIME type, e.g. "video/mp4"' },
  weight: { type: 'number', required: true,  desc: 'Relevance score 0–1', min: 0, max: 1 },

  // Set on documents produced by the vision actions (isolate / compose).
  generator:   { type: 'string', required: false, desc: 'Action that produced this document, if generated' },
  derivedFrom: { type: 'object', required: false, desc: 'Keys of the source documents it was generated from' },
  label:       { type: 'string', required: false, desc: 'Segment label from the segmentation model' },
  score:       { type: 'number', required: false, desc: 'Model confidence for the segment', min: 0, max: 1 },

  // Set on documents fetched from elsewhere rather than uploaded or generated.
  origin:      { type: 'string', required: false, desc: 'Where it came from, e.g. "rss"' },
  sourceUrl:   { type: 'string', required: false, desc: 'The URL it was fetched from' },
  attribution: { type: 'string', required: false, desc: 'Who published it' },
  summarizedFrom: { type: 'string', required: false, desc: 'The text before it was condensed' },

  // What an image was found to contain, by action/analyse.js.
  labels:      { type: 'object', required: false, desc: 'Subjects found in the image, most prominent first' },
  subjects:    { type: 'object', required: false, desc: 'Those subjects with coverage and confidence' },
  analysedAt:  { type: 'object', required: false, desc: 'When it was last analysed' },
};

/**
 * True if the machine acquired this rather than the user providing it — whether
 * by generating it or fetching it. `prune` may evict these under the data budget;
 * uploads are never touched.
 */
export function isMachineOwned(doc) {
  return typeof doc?.generator === 'string' || typeof doc?.origin === 'string';
}

/** True if the document was produced by a vision action rather than indexed from disk. */
export function isDerivative(doc) {
  return typeof doc?.generator === 'string' && doc.generator !== '';
}

/** How many generations of derivation a document is from an indexed original. */
export function derivationDepth(doc) {
  return Array.isArray(doc?.derivedFrom) ? doc.derivedFrom.length : 0;
}

export const REQUIRED = Object.keys(FIELDS).filter(k => FIELDS[k].required);

/**
 * Check a document against the model.
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validate(doc, { strict = false } = {}) {
  const errors = [];

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['document must be an object'] };
  }

  for (const [field, spec] of Object.entries(FIELDS)) {
    const value = doc[field];

    if (value === undefined || value === null) {
      if (spec.required) errors.push(`missing required field: ${field}`);
      continue;
    }

    if (typeof value !== spec.type) {
      errors.push(`${field} must be a ${spec.type}, got ${typeof value}`);
      continue;
    }

    if (spec.type === 'string' && value.trim() === '') {
      errors.push(`${field} must not be empty`);
    }

    if (spec.type === 'number') {
      if (Number.isNaN(value)) errors.push(`${field} must not be NaN`);
      if (spec.min !== undefined && value < spec.min) errors.push(`${field} must be >= ${spec.min}, got ${value}`);
      if (spec.max !== undefined && value > spec.max) errors.push(`${field} must be <= ${spec.max}, got ${value}`);
    }
  }

  if (strict) {
    for (const field of Object.keys(doc)) {
      if (field !== '_id' && !(field in FIELDS)) errors.push(`unknown field: ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Build a conforming document from a partial one, filling what can be derived.
 * Does not invent a `key` or `source` — those must be supplied.
 */
export function normalize(input = {}) {
  const doc = { ...input };

  if (!doc.key && doc.source) doc.key = doc.source;
  if (!doc.source && doc.key) doc.source = doc.key;
  if (!doc.name && doc.source) doc.name = doc.source.split('/').pop();
  if (!doc.type && doc.name) doc.type = mime.getType(doc.name) || '';
  if (typeof doc.weight !== 'number') doc.weight = Math.random();

  return doc;
}

/**
 * Coarse media kind used to pick a player. Mirrors the client's
 * `stores/media.js` mediaType computed — keep the two in step.
 */
export function mediaKind(doc) {
  const type = doc?.type ?? '';
  if (type.includes('video')) return 'video';
  if (type.includes('image')) return 'image';
  if (type.includes('audio')) return 'audio';
  if (type.includes('text'))  return 'text';
  return null;
}

export default { FIELDS, REQUIRED, validate, normalize, mediaKind, isDerivative, derivationDepth, isMachineOwned };

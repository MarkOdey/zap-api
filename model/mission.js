import crypto from 'node:crypto';

/**
 * A mission: a broad, open-ended prompt the agent sets and the user answers with
 * text, image, or video. Missions live in the `missions` collection and never
 * appear in playback.
 */

export const KINDS = ['find', 'create', 'answer'];
export const MEDIA = ['image', 'video', 'text'];

/** Build a conforming mission from a partial one, filling what can be derived. */
export function normalize(input = {}) {
  const m = { ...input };

  m.prompt = typeof m.prompt === 'string' ? m.prompt.trim() : '';
  m.kind = KINDS.includes(m.kind) ? m.kind : 'find';
  m.accepts = Array.isArray(m.accepts) ? m.accepts.filter(a => MEDIA.includes(a)) : [];
  if (m.accepts.length === 0) m.accepts = ['image', 'video', 'text'];
  m.terms = normalizeTerms(m.terms);
  m.origin = typeof m.origin === 'string' ? m.origin : 'template';
  m.status = m.status ?? 'open';
  m.responses = Array.isArray(m.responses) ? m.responses : [];
  if (!m.createdAt) m.createdAt = new Date();
  if (!m.key) m.key = `mission-${hash(m.prompt + Date.now() + Math.random())}`;

  return m;
}

/** Terms may arrive as strings or {label,...}; store as lowercase strings. */
export function normalizeTerms(terms) {
  if (!Array.isArray(terms)) return [];
  return [...new Set(
    terms
      .map(t => (typeof t === 'string' ? t : t?.label))
      .filter(t => typeof t === 'string' && t.trim())
      .map(t => t.trim().toLowerCase()),
  )];
}

/** @returns {{valid:boolean, errors:string[]}} */
export function validate(mission) {
  const errors = [];
  if (mission === null || typeof mission !== 'object') return { valid: false, errors: ['mission must be an object'] };
  if (typeof mission.prompt !== 'string' || !mission.prompt.trim()) errors.push('prompt must be a non-empty string');
  if (mission.prompt && mission.prompt.length > 300) errors.push('prompt is too long');
  if (!KINDS.includes(mission.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}`);
  if (!Array.isArray(mission.accepts) || mission.accepts.length === 0) errors.push('accepts must be a non-empty array');
  else if (mission.accepts.some(a => !MEDIA.includes(a))) errors.push(`accepts must be from ${MEDIA.join(', ')}`);
  return { valid: errors.length === 0, errors };
}

function hash(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
}

export default { KINDS, MEDIA, normalize, normalizeTerms, validate };

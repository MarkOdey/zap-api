/**
 * A theme: a label plus a lexicon of terms, generated hourly from recurrence /
 * calendar / a scheduled domain. Stored in the `themes` collection; the current
 * theme is the latest un-expired one.
 */

/** Default how long a theme stays current. */
export const THEME_TTL_MS = Number(process.env.THEME_TTL_MS || 60 * 60 * 1000);

export function normalize(input = {}) {
  const t = { ...input };
  t.label = typeof t.label === 'string' ? t.label.trim() : '';
  t.domain = typeof t.domain === 'string' ? t.domain : null;
  t.terms = Array.isArray(t.terms)
    ? [...new Set(t.terms
        .map(x => (typeof x === 'string' ? x : x?.label))
        .filter(x => typeof x === 'string' && x.trim())
        .map(x => x.trim().toLowerCase()))]
    : [];
  if (!t.generatedAt) t.generatedAt = new Date();
  if (!t.expiresAt) t.expiresAt = new Date(t.generatedAt.getTime() + THEME_TTL_MS);
  return t;
}

export function validate(theme) {
  const errors = [];
  if (!theme || typeof theme !== 'object') return { valid: false, errors: ['theme must be an object'] };
  if (typeof theme.label !== 'string' || !theme.label.trim()) errors.push('label must be a non-empty string');
  if (!Array.isArray(theme.terms) || theme.terms.length === 0) errors.push('terms must be a non-empty array');
  return { valid: errors.length === 0, errors };
}

export default { THEME_TTL_MS, normalize, validate };

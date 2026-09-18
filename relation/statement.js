/**
 * Pairs a visual document with an audio one: the player shows the image while the
 * track plays. Deliberately NOT in the default export — cognition/relate.js draws
 * random edge types from that, and would otherwise invent soundtracks.
 */
export const SOUNDTRACK = 'soundtrack';

/**
 * Two documents found to contain the same thing.
 *
 * Kept out of the default export for the same reason as SOUNDTRACK: relate draws
 * random types from that when it has nothing better, and this type means something
 * specific — it should only ever be created deliberately.
 */
export const SUBJECT = 'subject';

export default {
  FAMILY:         'family',
  LOCATION:       'location',
  THEME:          'theme',
  SYNTACTIC_ROLE: 'syntactic_role',
  TEMPORAL:       'temporal',
};

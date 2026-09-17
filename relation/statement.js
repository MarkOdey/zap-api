/**
 * Pairs a visual document with an audio one: the player shows the image while the
 * track plays. Deliberately NOT in the default export — cognition/relate.js draws
 * random edge types from that, and would otherwise invent soundtracks.
 */
export const SOUNDTRACK = 'soundtrack';

export default {
  FAMILY:         'family',
  LOCATION:       'location',
  THEME:          'theme',
  SYNTACTIC_ROLE: 'syntactic_role',
  TEMPORAL:       'temporal',
};

import { getCurrentTheme, generateAndStore } from '../missions/themeStore.js';

/**
 * Regenerate the theme when the current one is missing or expired (hourly by
 * default). The lexicon it produces steers missions and the media-finding loop.
 */
export default async function themeTask() {
  const current = await getCurrentTheme();
  if (current) return;
  await generateAndStore();
}

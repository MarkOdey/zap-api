import prune from '../action/prune.js';

/**
 * Periodic library maintenance. The work lives in action/prune.js so it can also
 * be run by hand from the terminal or the CLI.
 */
export default async function pruneTask() {
  await prune();
}

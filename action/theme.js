import { getCurrentTheme, generateAndStore, getConfig, setConfig } from '../missions/themeStore.js';

/**
 * Read or steer the time-aware theme.
 * @param {object} params  { op: 'get'|'regenerate'|'getSchedule'|'setSchedule'|'setDomains', schedule?, domains? }
 */
async function theme(params = {}) {
  const op = (typeof params === 'string' ? params : params?.op) || 'get';

  if (op === 'get') return (await getCurrentTheme()) ?? { label: null, terms: [] };
  if (op === 'regenerate') return generateAndStore();
  if (op === 'getSchedule') return getConfig();
  if (op === 'setSchedule') return setConfig({ schedule: params.schedule });
  if (op === 'setDomains') return setConfig({ domains: params.domains });

  throw new Error(`theme: unknown op ${op}`);
}

export default theme;

import { describe } from './registry.js';

/**
 * List the available actions and their arguments.
 *
 * Reads the same registry the CLI, terminal and queue dispatch from, so it can
 * never drift from what is actually callable.
 *
 * Imports from registry.js, which imports this — an ES module cycle that is safe
 * here because `describe` is only called at request time, never while loading.
 *
 * @param {object|string} [params]        an action name, or {action}
 * @returns {Promise<{lines: string[], actions: object[]}>}
 */
async function help(params) {
  const wanted = typeof params === 'string' ? params : params?.action;
  const actions = describe().sort((a, b) => a.name.localeCompare(b.name));

  if (wanted) {
    const spec = actions.find(a => a.name === wanted);
    if (!spec) {
      return {
        lines: [
          `unknown action: ${wanted}`,
          `available: ${actions.map(a => a.name).join(', ')}`,
        ],
        actions: [],
      };
    }
    return { lines: detail(spec), actions: [spec] };
  }

  const width = Math.max(...actions.map(a => a.name.length));
  const lines = [
    `${actions.length} actions — "help <action>" for one`,
    '',
    ...actions.map(a => {
      const args = a.params.length ? a.params.map(p => `<${p}>`).join(' ') : '—';
      const tag = a.queueable ? '  [queued]' : '';
      return `${a.name.padEnd(width)}  ${args}${tag}`;
    }),
  ];

  return { lines, actions };
}

function detail(spec) {
  const lines = [spec.name];

  if (spec.params.length) {
    lines.push(`  arguments: ${spec.params.join(', ')}`);
    lines.push(`  usage:     ${spec.name} ${spec.params.map(p => `--${p}=…`).join(' ')}`);
    lines.push(`  or:        ${spec.name} ${spec.params.map(p => `<${p}>`).join(' ')}`);
  } else {
    lines.push('  takes no arguments');
  }

  if (spec.queueable) lines.push('  runs on the job queue — watch the queue panel for progress');
  else lines.push('  runs immediately and replies with its result');

  if (spec.needsSession) lines.push('  needs a live playback session (CLI only)');

  return lines;
}

export default help;

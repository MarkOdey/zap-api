import * as bank from '../missions/bank.js';

/**
 * Maintain the runtime prompt bank.
 * @param {object} params  { op: 'list'|'add'|'update'|'remove'|'seed', ... }
 */
async function prompt(params = {}) {
  const op = (typeof params === 'string' ? params : params?.op) || 'list';

  if (op === 'list') return { prompts: await bank.list() };
  if (op === 'seed') return bank.seed();
  if (op === 'add') return bank.add(params);
  if (op === 'update') {
    if (!params.id) throw new Error('prompt: update needs an id');
    return bank.update(params.id, params);
  }
  if (op === 'remove') {
    if (!params.id) throw new Error('prompt: remove needs an id');
    return bank.remove(params.id);
  }

  throw new Error(`prompt: unknown op ${op}`);
}

export default prompt;

import adjust from './adjust.js';
import appreciate from './appreciate.js';
import compose from './compose.js';
import connect from './connect.js';
import crop from './crop.js';
import disconnect from './disconnect.js';
import explore from './explore.js';
import find from './find.js';
import help from './help.js';
import ingest from './ingest.js';
import isolate from './isolate.js';
import list from './list.js';
import normalize from './normalize.js';
import effect from './effect.js';
import montage from './montage.js';
import render from './render.js';
import speak from './speak.js';
import subscribe from './subscribe.js';
import play from './play.js';
import prune from './prune.js';
import record from './record.js';
import remove from './remove.js';
import removeAll from './removeAll.js';
import traverse from './traverse.js';
import update from './update.js';
import updateEdge from './updateEdge.js';
import upload from './upload.js';

/**
 * The one place actions are named.
 *
 * Used by the CLI (index.js), the terminal dispatcher (session.js) and the job
 * queue worker, so a new action becomes available everywhere by being added here.
 *
 * `queueable: true` means the action is slow enough to be worth running through
 * the queue rather than inline — the vision actions take ~20s, explore scales
 * with the library.
 *
 * `subprocess: true` means it must run in its own process. ONNX inference is
 * CPU-bound and synchronous, so in the API process it blocked the event loop for
 * seconds at a time and playback stalled while a job ran. ffmpeg actions do not
 * need this: they already spawn.
 */
// `concat` is deliberately absent: it shells out to ./action/mmcat, a binary that
// exists nowhere in the repo or the image, and reads SourceFile/FileName — exiftool
// fields nothing has written since the document model landed. Listing it would put a
// command in the terminal that can only ever fail. The file is kept for whoever
// reimplements it with ffmpeg.
export const ACTIONS = {
  explore:    { fn: explore,    queueable: true,  params: [] },
  ingest:     { fn: ingest,     queueable: true,  params: ['url', 'limit'] },
  isolate:    { fn: isolate,    queueable: true,  subprocess: true, params: ['key', 'label', 'all'] },
  compose:    { fn: compose,    queueable: true,  subprocess: true, params: ['from', 'to', 'label', 'scale', 'x', 'y', 'opacity'] },
  render:     { fn: render,     queueable: true,  params: ['visual', 'audio', 'maxDim', 'background'] },
  adjust:     { fn: adjust,     queueable: true,  params: ['key', 'adjust', 'sigma', 'brightness', 'saturation', 'hue', 'colour', 'value', 'levels', 'degrees'] },
  effect:     { fn: effect,     queueable: true,  params: ['key', 'effect', 'factor', 'seconds', 'degrees', 'brightness', 'contrast', 'saturation', 'direction', 'to'] },
  montage:    { fn: montage,    queueable: true,  params: ['keys', 'from', 'count', 'seconds', 'audio'] },
  speak:      { fn: speak,      queueable: true,  subprocess: true, params: ['key', 'narrate'] },
  upload:     { fn: upload,     queueable: true,  params: ['meta', 'data'] },
  normalize:  { fn: normalize,  queueable: true,  params: ['source'] },
  crop:       { fn: crop,       queueable: true,  params: ['key', 'start', 'duration'] },

  find:       { fn: find,       queueable: false, params: ['key'] },
  subscribe:  { fn: subscribe,  queueable: false, params: ['url', 'remove', 'list'] },
  // Called through a lambda, not referenced directly: help.js imports this module
  // to list the actions, so evaluating `help` here while that import is still in
  // flight throws "Cannot access 'help' before initialization". The lambda defers
  // the read until the action is actually invoked.
  help:       { fn: (...args) => help(...args), queueable: false, params: ['action'] },
  list:       { fn: list,       queueable: false, params: ['skip', 'limit', 'sort', 'order', 'type', 'search'] },
  record:     { fn: record,     queueable: false, params: ['key', 'source', 'name', 'type', 'weight'] },
  update:     { fn: update,     queueable: false, params: ['key', 'weight'] },
  connect:    { fn: connect,    queueable: false, params: ['from', 'to', 'type', 'weight'] },
  disconnect: { fn: disconnect, queueable: false, params: ['from', 'to', 'type'] },
  updateEdge: { fn: updateEdge, queueable: false, params: ['key', 'weight'] },
  traverse:   { fn: traverse,   queueable: false, params: ['key', 'type', 'direction'] },
  appreciate: { fn: appreciate, queueable: false, params: ['key', 'edgeKey', 'delta'] },
  prune:      { fn: prune,      queueable: false, params: ['dryRun', 'budgetMb'] },
  remove:     { fn: remove,     queueable: false, params: ['key', 'cascade'] },
  removeAll:  { fn: removeAll,  queueable: false, params: [] },

  // Needs a live session, so it is CLI/loop only — not a terminal command.
  play:       { fn: play,       queueable: false, params: [], needsSession: true },
};

/** name → fn, for callers that just want to dispatch. */
export const COMMANDS = Object.fromEntries(
  Object.entries(ACTIONS).map(([name, spec]) => [name, spec.fn]),
);

/** Serializable description of every action, for the client's terminal autocomplete. */
export const describe = () =>
  Object.entries(ACTIONS).map(([name, spec]) => ({
    name,
    params: spec.params,
    queueable: !!spec.queueable,
    subprocess: !!spec.subprocess,
    needsSession: !!spec.needsSession,
  }));

export default ACTIONS;

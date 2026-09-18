import Session from './session.js';
import Cognition from './cognition.js';
import { COMMANDS } from './action/registry.js';
import play from './action/play.js';
import drainOne from './utils/worker.js';

import exploreTask from './cognition/explore.js';
import relateTask  from './cognition/relate.js';
import pruneTask   from './cognition/prune.js';
import generateTask from './cognition/generate.js';

// Register actions that connected sessions will run
Session.addAction(play);

// CLI: node index.js <action> [params]
const cliAction = process.argv[2];
if (cliAction) {
  const actionFn = COMMANDS[cliAction];
  if (actionFn) {
    // Actions like isolate/compose take an object, so accept JSON on the CLI:
    //   node index.js isolate '{"key":"data/a.jpg","label":"person"}'
    const raw = process.argv[3];
    let params = raw;
    if (raw?.trimStart().startsWith('{')) {
      try {
        params = JSON.parse(raw);
      } catch (err) {
        console.error('Invalid JSON parameter:', err.message);
        process.exit(1);
      }
    }
    actionFn(params).then(() => process.exit(0)).catch(err => {
      console.error(err);
      process.exit(1);
    });
  } else {
    console.error('Unknown action:', cliAction);
    console.error('Available:', Object.keys(COMMANDS).join(', '));
    process.exit(1);
  }
}

const cognition = new Cognition();
// Drain the job queue often; Cognition reschedules only after a run settles, so a
// 20s inference job cannot be overlapped by the next tick.
// Idle poll only: the worker keeps going while jobs remain, so a backlog is not
// paced by this interval — see utils/worker.js.
cognition.register('queue',   drainOne,    Number(process.env.QUEUE_INTERVAL_MS || 5000));
cognition.register('explore', exploreTask, 60 * 1000);
cognition.register('relate',  relateTask,  30 * 1000);
cognition.register('prune',   pruneTask,  120 * 1000);
// Ticks often, but only acts when the queue is completely idle — see generate.js.
cognition.register('generate', generateTask, Number(process.env.GENERATE_INTERVAL_MS || 30 * 1000));
cognition.start();

Session.attachCognition(cognition);

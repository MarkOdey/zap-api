const play      = require('./action/play.js');
const find      = require('./action/find.js');
const crop      = require('./action/crop.js');
const concat    = require('./action/concat.js');
const removeAll = require('./action/removeAll.js');
const explore   = require('./action/explore.js');
const upload    = require('./action/upload.js');

const Session   = require('./session.js');
const Cognition = require('./cognition.js');

// Actions available via CLI invocation
const actions = { play, find, crop, concat, removeAll, explore, upload };

// Register actions that connected sessions will run
Session.addAction(play);

// CLI: node index.js <action> [params]
const cliAction = process.argv[2];
if (cliAction) {
  const actionFn = actions[cliAction];
  if (actionFn) {
    const params = process.argv[3];
    actionFn(params).then(() => process.exit(0)).catch(err => {
      console.error(err);
      process.exit(1);
    });
  } else {
    console.error('Unknown action:', cliAction);
    console.error('Available:', Object.keys(actions).join(', '));
    process.exit(1);
  }
}

const cognition = new Cognition();
cognition.run();

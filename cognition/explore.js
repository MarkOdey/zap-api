const explore = require('../action/explore');

async function exploreTask() {
  await explore();
}

module.exports = exploreTask;

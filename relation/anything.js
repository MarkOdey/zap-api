const find = require('../action/find.js');

async function anything(key) {
  console.log('anything: finding', key);
  const data = await find(key);
  console.log('anything: result', data);
  return data;
}

module.exports = anything;

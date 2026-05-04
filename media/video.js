const normalize = require('../action/normalize.js');
const File = require('./file.js');

async function Video(data) {
  if (!data?.source) return;

  const normalized = await normalize(data);
  Object.assign(data, normalized);

  await File(data);
  console.log('video: processed', data.source);
}

Video.equals = function (payload) {
  return typeof payload === 'object'
    && typeof payload.type === 'string'
    && payload.type.includes('video')
    && !!payload.name;
};

module.exports = Video;

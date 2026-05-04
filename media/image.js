const File = require('./file.js');

async function Image(data) {
  if (!data?.source) return;
  data.key = data.key || data.source;
  await File(data);
  console.log('image: processed', data.source);
}

Image.equals = function (payload) {
  return typeof payload === 'object'
    && typeof payload.type === 'string'
    && payload.type.includes('image')
    && !!payload.name;
};

module.exports = Image;

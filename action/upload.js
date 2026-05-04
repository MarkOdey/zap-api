const fs = require('fs').promises;
const record = require('./record.js');

async function upload(data) {
  if (typeof data === 'string') data = JSON.parse(data);

  const { meta, data: payload } = data;
  if (!meta?.name) throw new Error('upload: missing meta.name');

  const base64 = payload.split(';base64,').pop();
  const source = 'data/' + meta.name;

  await fs.writeFile(source, base64, { encoding: 'base64' });
  console.log('upload: file written to', source);

  await record({ key: source, source, ...meta });
}

module.exports = upload;

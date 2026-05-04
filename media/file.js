const { spawn } = require('child_process');
const record = require('../action/record.js');

function getMetaData(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('exif', ['-m', '-c', filePath]);
    let output = '';
    proc.stdout.on('data', d => { output += d; });
    proc.on('error', reject);
    proc.on('close', () => {
      const metaData = {};
      for (const line of output.split('\n')) {
        const [k, v] = line.split('\t');
        if (k) metaData[k] = v;
      }
      resolve(metaData);
    });
  });
}

async function File(file) {
  if (!file?.source) return;

  const key = file.key || file.source;
  const meta = await getMetaData(file.source);

  await record({ ...file, ...meta, key });
  console.log('file: record updated for', key);
}

File.equals = function (data) {
  const fs = require('fs');
  return data?.source && fs.existsSync(data.source);
};

module.exports = File;

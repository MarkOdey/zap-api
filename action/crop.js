const { spawn } = require('child_process');
const find = require('./find.js');

async function crop(key, start = 0, duration = 3) {
  const file = await find(key);
  if (!file) throw new Error('crop: file not found for key ' + key);

  const filename = ('./data/' + start + duration + file.FileName).replace(/\./g, '');

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', file.SourceFile, '-y',
      '-ss', start, '-t', duration,
      '-acodec', 'copy', '-vcodec', 'copy',
      '-async', '1', filename
    ]);
    proc.stderr.on('data', d => console.log('ffmpeg:', String(d).trim()));
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) { reject(new Error(`ffmpeg exited with code ${code}`)); return; }
      console.log('crop: wrote', filename);
      resolve(filename);
    });
  });
}

module.exports = crop;

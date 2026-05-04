const { spawn } = require('child_process');
const path = require('path');

function normalize(data) {
  return new Promise((resolve, reject) => {
    if (!data?.source) {
      reject(new Error('normalize: no source defined'));
      return;
    }

    const ext = path.extname(data.source);
    const base = data.source.slice(0, -ext.length);
    const normalizedFile = base + '.mp4';

    const cmd = spawn('ffmpeg', [
      '-i', data.source, '-y',
      '-vcodec', 'libx264', '-crf', '23', '-preset', 'ultrafast',
      '-acodec', 'aac', '-strict', 'experimental',
      '-ac', '2', '-ar', '44100', '-ab', '128k',
      '-async', '1', normalizedFile
    ]);

    cmd.stderr.on('data', d => console.log('ffmpeg:', String(d).trim()));
    cmd.on('error', reject);
    cmd.on('close', code => {
      if (code !== 0) { reject(new Error(`ffmpeg exited with code ${code}`)); return; }
      resolve({ ...data, source: normalizedFile });
    });
  });
}

module.exports = normalize;

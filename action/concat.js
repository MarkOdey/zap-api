const { spawn } = require('child_process');
const MongoConnexion = require('../utils/MongoConnexion');

async function concat() {
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('data');

  const random = Math.random();
  const docs = await col.find({ weight: { $gt: random, $lt: random + 0.3 } }).limit(2).toArray();

  if (!docs || docs.length < 2) {
    console.log('concat: not enough files found');
    return;
  }

  const [file1, file2] = docs;
  const filename = ('./data/concat' + file1.FileName + file2.FileName).replace(/\./g, '') + '.mp4';

  return new Promise((resolve, reject) => {
    const proc = spawn('./action/mmcat', [file1.SourceFile, file2.SourceFile, filename]);
    proc.stdout.on('data', d => console.log('mmcat:', String(d).trim()));
    proc.stderr.on('data', d => console.log('mmcat err:', String(d).trim()));
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) { reject(new Error(`mmcat exited with code ${code}`)); return; }
      console.log('concat: wrote', filename);
      resolve(filename);
    });
  });
}

module.exports = concat;

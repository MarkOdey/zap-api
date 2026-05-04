const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const MongoConnexion = require('../utils/MongoConnexion');

function getMetaData(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('exiftool', ['-json', filePath]);
    let output = '';
    proc.stdout.on('data', d => { output += d; });
    proc.on('error', reject);
    proc.on('close', () => {
      try {
        resolve(JSON.parse(output)[0]);
      } catch (e) {
        reject(new Error(`exiftool parse failed for ${filePath}: ${e.message}`));
      }
    });
  });
}

async function explore() {
  const mongoclient = await MongoConnexion.get();
  const col = mongoclient.db('zap').collection('data');
  const dataDir = process.env.DATA_DIR || './data';

  let files;
  try {
    files = await fs.readdir(dataDir);
  } catch (e) {
    console.error('explore: cannot read data dir', dataDir, e.message);
    return;
  }

  for (const filename of files) {
    const filePath = path.join(dataDir, filename);
    try {
      const meta = await getMetaData(filePath);
      if (!meta) continue;

      const doc = {
        key:    filePath,
        name:   meta.FileName  || filename,
        source: filePath,
        type:   meta.MIMEType  || '',
        weight: Math.random(),
      };

      await col.updateOne(
        { key: doc.key },
        { $set: doc },
        { upsert: true }
      );
      console.log('indexed:', filename);
    } catch (e) {
      console.warn('explore: skipping', filename, '-', e.message);
    }
  }

  console.log('explore: done indexing', files.length, 'files');
}

module.exports = explore;

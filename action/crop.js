import { spawn } from 'child_process';
import path from 'path';
import find from './find.js';

/** Accepts (key, start, duration) from the CLI or {key, start, duration}. */
async function crop(params, startArg, durationArg) {
  const named = typeof params === 'object' && params !== null;
  const key = named ? params.key : params;
  const start = (named ? params.start : startArg) ?? 0;
  const duration = (named ? params.duration : durationArg) ?? 3;

  if (!key) throw new Error('crop: key is required');

  const file = await find(key);
  if (!file) throw new Error('crop: file not found for key ' + key);

  // `source`/`name`, not SourceFile/FileName — those were exiftool fields that
  // nothing has written since the document model landed.
  const base = path.basename(file.name ?? 'clip', path.extname(file.name ?? ''));
  const filename = path.join(
    path.dirname(file.source),
    `${base}.crop-${start}-${duration}${path.extname(file.source)}`,
  );

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', file.source, '-y',
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

export default crop;
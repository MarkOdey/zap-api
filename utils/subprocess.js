import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'run-action.mjs');

/** Marker the runner prints so its return value can be recovered. */
const RESULT = '__RESULT__';

/**
 * Run an action in a child process and resolve with its return value.
 *
 * Used for anything CPU-bound in-process. ffmpeg actions do not need this — they
 * already spawn — but ONNX inference does not, and blocked the event loop for
 * seconds at a time, stalling playback while a job ran.
 */
export function runInSubprocess(action, params = {}, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER, action, JSON.stringify(params)], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let result = null;
    let stderr = '';
    let buffered = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${action}: timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      let index;
      while ((index = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, index);
        buffered = buffered.slice(index + 1);
        if (line.startsWith(RESULT)) {
          try { result = JSON.parse(line.slice(RESULT.length)); } catch { /* keep null */ }
        } else if (line.trim()) {
          // Relay the child's log so it reads as though it ran here.
          console.log(line);
        }
      }
    });

    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => { clearTimeout(timer); reject(err); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(result);
      else reject(new Error(stderr.trim().split('\n').pop() || `${action} exited with ${code}`));
    });
  });
}

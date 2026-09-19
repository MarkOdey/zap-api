/**
 * Thin client for a local Ollama server.
 *
 * Ollama runs on the same machine (no API key, nothing leaves the box), so this is
 * a small wrapper over its HTTP `generate` endpoint with JSON output. `fetch` is
 * injectable so callers and tests can supply responses without a running model.
 */

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 30_000);

/**
 * Ask the model for one completion. With `format: 'json'` Ollama constrains the
 * output to valid JSON, which is what the mission/theme generators parse.
 *
 * @returns {Promise<string>} the raw response text
 */
export async function generate(prompt, {
  model = OLLAMA_MODEL,
  format = 'json',
  system,
  url = OLLAMA_URL,
  fetch: fetchFn = globalThis.fetch,
  signal,
} = {}) {
  const body = { model, prompt, stream: false };
  if (format) body.format = format;
  if (system) body.system = system;

  const res = await fetchFn(`${url.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`ollama: HTTP ${res.status}`);
  const data = await res.json();
  return data?.response ?? '';
}

/** True if the local Ollama answers, so callers can fall back cleanly when not. */
export async function reachable({ url = OLLAMA_URL, fetch: fetchFn = globalThis.fetch } = {}) {
  try {
    const res = await fetchFn(`${url.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Pull the first JSON object out of a model response, tolerating stray prose. */
export function parseJsonObject(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch { /* try to salvage a JSON object embedded in prose */ }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch { /* give up */ }
  }
  return null;
}

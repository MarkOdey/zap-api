import { normalize as normalizeMission } from '../model/mission.js';

/**
 * The offline last resort: build a mission from a library term using a fixed
 * template. Narrow by design — this only runs when neither Ollama nor the bank is
 * available — so the feature degrades rather than stopping.
 */

const TEMPLATES = [
  { kind: 'find',   accepts: ['image', 'video'], make: (t) => `Show me something with ${t}.` },
  { kind: 'create', accepts: ['image', 'video'], make: (t) => `Capture ${t} in your own way.` },
  { kind: 'answer', accepts: ['text'],           make: (t) => `Tell me about ${t}.` },
];

const FALLBACK_TERMS = ['the sky', 'something blue', 'a face', 'your surroundings', 'light'];

export function generateMission(context = {}, { rand = Math.random } = {}) {
  const terms = (context.terms?.length ? context.terms : FALLBACK_TERMS);
  const term = terms[Math.floor(rand() * terms.length)];
  const tpl = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];

  return normalizeMission({
    prompt: tpl.make(term),
    kind: tpl.kind,
    accepts: tpl.accepts,
    terms: [term],
    origin: 'template',
    source: 'template',
  });
}

export default { generateMission, TEMPLATES };

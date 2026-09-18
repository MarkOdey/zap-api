import sharp from 'sharp';

/**
 * Render text as an image frame, sized so it fills the frame.
 *
 * SVG has no automatic wrapping, so lines are broken here and emitted as separate
 * <text> elements. A monospace face makes that reliable: every glyph in DejaVu
 * Sans Mono is 0.6em wide, so the fit can be computed rather than measured.
 */
const CHAR_WIDTH_RATIO = 0.6;
const LINE_HEIGHT_RATIO = 1.3;

/** Fraction of the frame the text may occupy, leaving a margin. */
const FILL = 0.88;

const FONT = process.env.TEXT_FRAME_FONT || 'DejaVu Sans Mono, monospace';

/**
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.width=1280]
 * @param {number} [options.height=720]
 * @param {string} [options.background='black']
 * @param {string} [options.colour='white']
 * @returns {Promise<Buffer>} PNG
 */
export async function renderTextFrame(text, {
  width = 1280,
  height = 720,
  background = 'black',
  colour = 'white',
} = {}) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('textFrame: nothing to render');

  const { size, lines } = fit(clean, width, height);

  const lineHeight = size * LINE_HEIGHT_RATIO;
  const blockHeight = lines.length * lineHeight;
  // Baseline of the first line, so the block sits centred.
  const firstBaseline = (height - blockHeight) / 2 + size;

  const spans = lines
    .map((line, i) =>
      `<text x="${width / 2}" y="${firstBaseline + i * lineHeight}" ` +
      `text-anchor="middle" font-family="${FONT}" font-size="${size}" ` +
      `font-weight="bold" fill="${colour}">${escapeXml(line)}</text>`)
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="100%" height="100%" fill="${background}"/>${spans}</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Largest font size at which the wrapped text still fits, mirroring the client's
 * text player: short strings go very large, long ones step down.
 */
function fit(text, width, height) {
  const maxWidth = width * FILL;
  const maxHeight = height * FILL;

  for (let size = Math.floor(height / 2); size >= 10; size -= 2) {
    const perLine = Math.max(1, Math.floor(maxWidth / (size * CHAR_WIDTH_RATIO)));
    const lines = wrap(text, perLine);
    if (lines.length * size * LINE_HEIGHT_RATIO <= maxHeight) return { size, lines };
  }

  // Nothing fits: use the smallest size and let the caller's frame clip.
  const perLine = Math.max(1, Math.floor(maxWidth / (10 * CHAR_WIDTH_RATIO)));
  return { size: 10, lines: wrap(text, perLine).slice(0, Math.floor(maxHeight / 13)) };
}

/** Greedy word wrap, splitting a word longer than the line as a last resort. */
export function wrap(text, perLine) {
  const lines = [];
  let current = '';

  for (const word of text.split(' ')) {
    if (word.length > perLine) {
      if (current) { lines.push(current); current = ''; }
      for (let i = 0; i < word.length; i += perLine) lines.push(word.slice(i, i + perLine));
      continue;
    }
    if (!current) current = word;
    else if ((current + ' ' + word).length <= perLine) current += ' ' + word;
    else { lines.push(current); current = word; }
  }

  if (current) lines.push(current);
  return lines;
}

const escapeXml = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

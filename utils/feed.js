import { XMLParser } from 'fast-xml-parser';

/**
 * Fetching and normalising syndication feeds.
 *
 * Handles RSS 2.0 and Atom, which differ in almost every element name, and in the
 * wild are inconsistent even within a format — CDATA, namespaced media tags,
 * links as attributes or as text. A parser rather than regexes for that reason.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  trimValues: true,
});

/** Identify ourselves, as politeness requires of anything fetching on a timer. */
const USER_AGENT = process.env.FEED_USER_AGENT || 'zap/1.0 (personal media player)';

const TIMEOUT_MS = Number(process.env.FEED_TIMEOUT_MS || 15_000);

/**
 * Fetch and normalise a feed.
 * @returns {Promise<{title: string, url: string, items: object[]}>}
 */
export async function fetchFeed(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`feed: ${url} returned HTTP ${response.status}`);

  return parseFeed(await response.text(), url);
}

/** Separated from fetching so it can be tested without a network. */
export function parseFeed(xml, url = '') {
  const tree = parser.parse(xml);

  // RSS nests items under rss>channel; Atom puts entries at the root.
  const channel = tree?.rss?.channel ?? tree?.['rdf:RDF']?.channel;
  const atom = tree?.feed;

  if (channel) {
    return {
      title: text(channel.title) || url,
      url,
      items: asArray(channel.item ?? tree?.['rdf:RDF']?.item).map(fromRss).filter(Boolean),
    };
  }

  if (atom) {
    return {
      title: text(atom.title) || url,
      url,
      items: asArray(atom.entry).map(fromAtom).filter(Boolean),
    };
  }

  throw new Error(`feed: ${url || 'input'} is neither RSS nor Atom`);
}

function fromRss(item) {
  const title = text(item?.title);
  if (!title) return null;

  return {
    // guid identifies an item across fetches; the link is the usual fallback.
    id: text(item.guid) || text(item.link) || title,
    title,
    // Prefer whichever carries the most text. Many feeds publish a short
    // description alongside a full content:encoded — Mozilla's blog gives 534
    // characters in one and 6,915 in the other — and more input makes for a
    // better summary. Taking description first threw the article away.
    summary: richest(item.description, item['content:encoded'], item['content:encoded']?.['#text']),
    link: text(item.link),
    published: text(item.pubDate) || text(item['dc:date']) || null,
    // Only media the feed explicitly offers for syndication.
    image: mediaUrl(item),
  };
}

function fromAtom(entry) {
  const title = text(entry?.title);
  if (!title) return null;

  const links = asArray(entry.link);
  const alternate = links.find(l => (l?.['@rel'] ?? 'alternate') === 'alternate') ?? links[0];

  return {
    id: text(entry.id) || alternate?.['@href'] || title,
    title,
    summary: richest(entry.content, entry.summary),
    link: alternate?.['@href'] ?? text(entry.link),
    published: text(entry.published) || text(entry.updated) || null,
    image: links.find(l => String(l?.['@type'] ?? '').startsWith('image/'))?.['@href'] ?? null,
  };
}

/** An enclosure or media:content the feed publishes alongside the item. */
function mediaUrl(item) {
  const candidates = [
    ...asArray(item.enclosure),
    ...asArray(item['media:content']),
    ...asArray(item['media:thumbnail']),
  ];

  for (const c of candidates) {
    const href = c?.['@url'] ?? c?.['@href'];
    const type = String(c?.['@type'] ?? '');
    if (!href) continue;
    if (type.startsWith('image/') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(href)) return href;
  }

  return null;
}

/** The longest of several possible content fields, once markup is gone. */
function richest(...candidates) {
  let best = '';
  for (const c of candidates) {
    const value = strip(text(c));
    if (value.length > best.length) best = value;
  }
  return best;
}

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Values arrive as strings, numbers, or objects carrying a text node. */
function text(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return String(v['#text'] ?? '').trim();
}

/** Summaries are frequently HTML; the text player wants words. */
function strip(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

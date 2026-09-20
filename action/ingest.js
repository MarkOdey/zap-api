import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';

import MongoConnexion from '../utils/MongoConnexion.js';
import record from './record.js';
import { fetchFeed } from '../utils/feed.js';

/** Items taken from each feed per poll, newest first. */
const PER_FEED = Number(process.env.INGEST_PER_FEED || 5);

/**
 * Cap on the text kept per item.
 *
 * Sized for the summariser rather than the player: distilbart takes about 1024
 * tokens, roughly 4,000 characters, and truncates beyond that. Feeds that publish
 * only a headline are unaffected — most news feeds give 150 to 200 characters —
 * but one carrying a full article now keeps enough of it to summarise well.
 */
const MAX_CHARS = Number(process.env.INGEST_MAX_CHARS || 4000);

/**
 * Pull items from subscribed feeds into the library as text documents.
 *
 * Only what a feed publishes for syndication is used — headline, summary and link.
 * Every document carries `sourceUrl` and `attribution`, so where it came from
 * travels with it.
 *
 * Images are not fetched. A feed offering an enclosure invites a reader to show
 * it; downloading press photography and compositing it into generated videos is a
 * different thing, and not one to do by default.
 *
 * @param {object}  params
 * @param {string}   [params.url]    Ingest one feed instead of all subscribed ones
 * @param {number}   [params.limit]  Items per feed
 * @param {string[]} [params.terms]  Prefer items matching these terms (mission/theme lexicon)
 */
async function ingest({ url, limit = PER_FEED, terms = null } = {}) {
  const db = await MongoConnexion.db();
  const col = db.collection('data');

  const feeds = url
    ? [{ url }]
    : await db.collection('feeds').find({}, { projection: { url: 1, title: 1 } }).toArray();

  if (feeds.length === 0) {
    console.log('ingest: no feeds subscribed');
    return { feeds: 0, added: 0, skipped: 0 };
  }

  let added = 0;
  let skipped = 0;
  const dataDir = process.env.DATA_DIR || './data';

  for (const subscription of feeds) {
    let feed;
    try {
      feed = await fetchFeed(subscription.url);
    } catch (err) {
      console.warn('ingest: could not read', subscription.url, '—', err.message);
      continue;
    }

    // When steered by mission/theme terms, pull the matching items first.
    const ordered = terms?.length ? rankItemsByTerms(feed.items, terms) : feed.items;

    for (const item of ordered.slice(0, Math.max(1, Number(limit) || PER_FEED))) {
      // The item's own id is what identifies it across polls; a feed reordering
      // or re-publishing must not create a second copy.
      const fingerprint = crypto.createHash('sha1').update(item.id).digest('hex').slice(0, 12);
      const key = path.join(dataDir, `rss-${fingerprint}.txt`);

      if (await col.countDocuments({ key })) { skipped++; continue; }

      const body = [item.title, item.summary].filter(Boolean).join('\n\n').slice(0, MAX_CHARS);
      await fs.writeFile(key, body, 'utf8');

      await record({
        key,
        source: key,
        name: path.basename(key),
        type: 'text/plain',
        origin: 'rss',
        sourceUrl: item.link || subscription.url,
        attribution: feed.title || subscription.title || subscription.url,
      });

      added++;
    }
  }

  console.log(`ingest: ${added} new, ${skipped} already held, from ${feeds.length} feed(s)`);
  return { feeds: feeds.length, added, skipped };
}

/**
 * Stable-sort feed items so those mentioning a term come first. Pure, so it is
 * testable without a network. Ties keep the feed's own (newest-first) order.
 */
export function rankItemsByTerms(items, terms) {
  const needles = terms.map(t => String(t).toLowerCase()).filter(Boolean);
  const score = (item) => {
    const hay = `${item?.title ?? ''} ${item?.summary ?? ''}`.toLowerCase();
    return needles.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
  };
  return items
    .map((item, i) => ({ item, i, s: score(item) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.item);
}

export default ingest;

import MongoConnexion from '../utils/MongoConnexion.js';
import { fetchFeed } from '../utils/feed.js';

/**
 * Manage syndication feed subscriptions.
 *
 * Feeds live in their own collection rather than as documents: they are not media
 * and must never turn up in playback.
 *
 * @param {object}  params
 * @param {string} [params.url]     Feed to add
 * @param {boolean}[params.remove]  Remove it instead
 * @param {boolean}[params.list]    Just list what is subscribed
 */
async function subscribe({ url, remove = false, list = false } = {}) {
  const db = await MongoConnexion.db();
  const col = db.collection('feeds');

  if (list || (!url && !remove)) {
    const feeds = await col.find({}, { projection: { _id: 0 } }).toArray();
    return {
      feeds,
      lines: feeds.length
        ? feeds.map(f => `${f.title ?? '(untitled)'} — ${f.url}`)
        : ['no feeds subscribed — try: subscribe --url=https://example.com/rss.xml'],
    };
  }

  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('subscribe: url must be an http(s) feed address');
  }

  if (remove) {
    const { deletedCount } = await col.deleteOne({ url });
    console.log(`subscribe: ${deletedCount ? 'removed' : 'no such feed'} ${url}`);
    return { removed: deletedCount, lines: [deletedCount ? `removed ${url}` : `not subscribed: ${url}`] };
  }

  // Fetch once before storing, so a typo fails here rather than every poll.
  const feed = await fetchFeed(url);

  await col.updateOne(
    { url },
    { $set: { url, title: feed.title }, $setOnInsert: { addedAt: new Date() } },
    { upsert: true },
  );

  console.log(`subscribe: ${feed.title} (${feed.items.length} items available)`);
  return { url, title: feed.title, available: feed.items.length, lines: [`subscribed to ${feed.title}`] };
}

export default subscribe;

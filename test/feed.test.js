import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseFeed } from '../utils/feed.js';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example News</title>
    <item>
      <title><![CDATA[First & foremost]]></title>
      <description><![CDATA[<p>A <b>summary</b> with markup.</p>]]></description>
      <link>https://example.com/1</link>
      <guid isPermaLink="false">tag:example,1</guid>
      <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
      <enclosure url="https://example.com/a.jpg" type="image/jpeg" length="1234"/>
    </item>
    <item>
      <title>Second</title>
      <link>https://example.com/2</link>
      <media:content url="https://example.com/b.png" type="image/png"/>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <entry>
    <title>Atom item</title>
    <id>urn:uuid:1</id>
    <summary>Short summary.</summary>
    <link rel="alternate" href="https://example.com/atom-1"/>
    <updated>2024-01-01T10:00:00Z</updated>
  </entry>
</feed>`;

describe('feed: RSS', () => {
  it('reads the channel title and every item', () => {
    const feed = parseFeed(RSS);
    assert.equal(feed.title, 'Example News');
    assert.equal(feed.items.length, 2);
  });

  it('unwraps CDATA and decodes entities', () => {
    assert.equal(parseFeed(RSS).items[0].title, 'First & foremost');
  });

  it('strips markup from summaries — the text player renders words, not HTML', () => {
    const { summary } = parseFeed(RSS).items[0];
    assert.equal(summary, 'A summary with markup.');
    assert.ok(!summary.includes('<'));
  });

  it('prefers guid as the identity, since links change', () => {
    assert.equal(parseFeed(RSS).items[0].id, 'tag:example,1');
  });

  it('falls back to the link when there is no guid', () => {
    assert.equal(parseFeed(RSS).items[1].id, 'https://example.com/2');
  });

  it('finds media the feed publishes, as enclosure or media:content', () => {
    const items = parseFeed(RSS).items;
    assert.equal(items[0].image, 'https://example.com/a.jpg');
    assert.equal(items[1].image, 'https://example.com/b.png');
  });
});

describe('feed: Atom', () => {
  it('reads entries, which differ from RSS in every element name', () => {
    const feed = parseFeed(ATOM);
    assert.equal(feed.title, 'Example Atom');
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].title, 'Atom item');
    assert.equal(feed.items[0].link, 'https://example.com/atom-1');
    assert.equal(feed.items[0].id, 'urn:uuid:1');
  });
});

describe('feed: robustness', () => {
  it('rejects something that is neither RSS nor Atom', () => {
    assert.throws(() => parseFeed('<html><body>not a feed</body></html>'), /neither RSS nor Atom/);
  });

  it('copes with a feed that has no items', () => {
    const feed = parseFeed('<rss><channel><title>Empty</title></channel></rss>');
    assert.deepEqual(feed.items, []);
  });

  it('skips items with no title rather than producing blanks', () => {
    const feed = parseFeed('<rss><channel><title>T</title><item><link>https://x/1</link></item></channel></rss>');
    assert.deepEqual(feed.items, []);
  });

  it('handles a single item, which XML parsers give as an object not an array', () => {
    const feed = parseFeed('<rss><channel><title>T</title><item><title>Only</title></item></channel></rss>');
    assert.equal(feed.items.length, 1);
  });

  it('ignores media that is not an image', () => {
    const feed = parseFeed('<rss><channel><title>T</title><item><title>A</title>' +
      '<enclosure url="https://x/a.mp3" type="audio/mpeg"/></item></channel></rss>');
    assert.equal(feed.items[0].image, null);
  });
});

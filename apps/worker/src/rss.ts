import { XMLParser } from "fast-xml-parser";
import { sha256Hex } from "./crypto";
import { fetchTextWithRetry } from "./http";
import type { FeedSource, SourceItem } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  trimValues: true
});

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid"
]);

export async function fetchFeedItems(feeds: FeedSource[]): Promise<SourceItem[]> {
  const settled = await Promise.allSettled(feeds.map((feed) => fetchOneFeed(feed)));
  const items: SourceItem[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      console.warn(
        JSON.stringify({
          event: "feed_fetch_failed",
          feed: feeds[index]?.name ?? "unknown",
          error: errorMessage(result.reason)
        })
      );
    }
  });

  return items.sort((left, right) => {
    const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
    const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

export async function sourceHash(source: SourceItem): Promise<string> {
  return sha256Hex(source.canonicalUrl);
}

export async function fetchSourcePageText(source: SourceItem): Promise<string> {
  const { response, text } = await fetchTextWithRetry(
    source.url,
    {
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "The Ploradian bot/0.1 (+https://ploradian.com/about/)"
      }
    },
    {
      label: `source page ${source.url}`,
      timeoutMs: 8000,
      maxBytes: 18000,
      retries: 1
    }
  );

  if (!response.ok) {
    console.warn(
      JSON.stringify({
        event: "source_page_not_ok",
        url: source.url,
        status: response.status
      })
    );
    return "";
  }

  return htmlToText(text).slice(0, 4500);
}

async function fetchOneFeed(feed: FeedSource): Promise<SourceItem[]> {
  const { response, text, truncated } = await fetchTextWithRetry(
    feed.url,
    {
      headers: {
        accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
        "user-agent": "The Ploradian bot/0.1 (+https://ploradian.com/about/)"
      }
    },
    {
      label: `RSS feed ${feed.name}`,
      timeoutMs: 10000,
      maxBytes: 262144,
      retries: 2
    }
  );

  if (!response.ok) {
    throw new Error(`Feed ${feed.name} returned HTTP ${response.status}.`);
  }

  if (truncated) {
    console.warn(JSON.stringify({ event: "feed_truncated", feed: feed.name }));
  }

  const parsed = parser.parse(text) as unknown;
  return normalizeParsedFeed(parsed, feed);
}

function normalizeParsedFeed(parsed: unknown, feed: FeedSource): SourceItem[] {
  const record = asRecord(parsed);
  if (!record) {
    return [];
  }

  const rssChannel = asRecord(asRecord(record.rss)?.channel);
  const rssItems = rssChannel ? asArray(rssChannel.item) : [];

  if (rssItems.length > 0) {
    return rssItems.map((item) => normalizeRssItem(item, feed)).filter(isSourceItem);
  }

  const atomFeed = asRecord(record.feed);
  const atomEntries = atomFeed ? asArray(atomFeed.entry) : [];
  return atomEntries.map((entry) => normalizeAtomEntry(entry, feed)).filter(isSourceItem);
}

function normalizeRssItem(item: unknown, feed: FeedSource): SourceItem | null {
  const record = asRecord(item);
  if (!record) {
    return null;
  }

  const title = stringValue(record.title);
  const url = stringValue(record.link) || stringValue(record.guid);
  if (!title || !url) {
    return null;
  }

  const publishedAt = parseDate(stringValue(record.pubDate) || stringValue(record["dc:date"]));
  const normalized: SourceItem = {
    feedName: feed.name,
    feedUrl: feed.url,
    category: feed.category,
    title,
    url,
    canonicalUrl: canonicalizeUrl(url),
    summary: stripHtml(stringValue(record.description) || stringValue(record["content:encoded"])).slice(0, 900)
  };

  if (publishedAt) {
    normalized.publishedAt = publishedAt;
  }

  return normalized;
}

function normalizeAtomEntry(entry: unknown, feed: FeedSource): SourceItem | null {
  const record = asRecord(entry);
  if (!record) {
    return null;
  }

  const title = stringValue(record.title);
  const url = atomLink(record.link) || stringValue(record.id);
  if (!title || !url) {
    return null;
  }

  const publishedAt = parseDate(stringValue(record.published) || stringValue(record.updated));
  const summary = stringValue(record.summary) || stringValue(record.content);
  const normalized: SourceItem = {
    feedName: feed.name,
    feedUrl: feed.url,
    category: feed.category,
    title,
    url,
    canonicalUrl: canonicalizeUrl(url),
    summary: stripHtml(summary).slice(0, 900)
  };

  if (publishedAt) {
    normalized.publishedAt = publishedAt;
  }

  return normalized;
}

function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function htmlToText(html: string): string {
  return stripHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
  );
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function atomLink(value: unknown): string {
  const links = asArray(value);
  for (const link of links) {
    if (typeof link === "string") {
      return link;
    }
    const record = asRecord(link);
    if (record && (!record.rel || record.rel === "alternate") && typeof record.href === "string") {
      return record.href;
    }
  }
  return "";
}

function parseDate(raw: string): string | null {
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  const record = asRecord(value);
  if (record && typeof record["#text"] === "string") {
    return record["#text"].trim();
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function isSourceItem(value: SourceItem | null): value is SourceItem {
  return value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

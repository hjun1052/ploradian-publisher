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

export interface FeedFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
}

const DEFAULT_FEED_FETCH_OPTIONS = {
  timeoutMs: 10000,
  maxBytes: 262144,
  retries: 2
} satisfies Required<FeedFetchOptions>;

const SOURCE_PAGE_MAX_BYTES = 524288;
const USEFUL_PAGE_TEXT_MAX_CHARS = 3200;
const MIN_USEFUL_PAGE_TEXT_CHARS = 180;
const CONTENT_TAGS = ["article", "main", "section", "div"] as const;
const CONTENT_ATTR_PATTERN =
  "(?:article-view|articleViewCon|article|story|post|entry|body|bbs|board|view|content|main|news|cont)";
const NOISE_TERMS = [
  "Skip to main content",
  "Login / Sign Up",
  "Navigation Drawer",
  "Hamburger Navigation Button",
  "Posts from this topic",
  "Posts from this author",
  "Follow Follow",
  "Follow topics and authors",
  "Newsletter",
  "Subscribe",
  "Sign in dialog",
  "Story text Size",
  "Subscribers only",
  "Text settings",
  "Comments",
  "Share",
  "본문내용 바로가기",
  "주메뉴 바로가기",
  "전체메뉴",
  "사이트맵",
  "개인정보처리방침",
  "관련사이트",
  "주소복사",
  "주소 복사",
  "유용한 정보가 되었나요",
  "내가 본 콘텐츠"
];

const TRUNCATE_MARKERS = [
  "Follow topics and authors",
  "Posts from this author",
  "Related Articles",
  "More from",
  "Read next",
  "Comments",
  "관련기사",
  "기자의 다른기사",
  "저작권자",
  "무단전재",
  "목록 연관자료",
  "유용한 정보가 되었나요",
  "페이지 위로 이동",
  "개인정보처리방침"
];

interface TextCandidate {
  label: string;
  text: string;
  weight: number;
}

export async function fetchFeedItems(feeds: FeedSource[], options: FeedFetchOptions = {}): Promise<SourceItem[]> {
  const fetchOptions = { ...DEFAULT_FEED_FETCH_OPTIONS, ...options };
  const settled = await Promise.allSettled(feeds.map((feed) => fetchOneFeed(feed, fetchOptions)));
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
  if (source.synthetic) {
    return source.summary;
  }

  const { response, text } = await fetchTextWithRetry(
    source.url,
    {
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "The Ploradian bot/0.1 (+https://news.ploradian.com/about/)"
      }
    },
    {
      label: `source page ${source.url}`,
      timeoutMs: 8000,
      maxBytes: SOURCE_PAGE_MAX_BYTES,
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

  return extractUsefulPageText(text, source);
}

async function fetchOneFeed(feed: FeedSource, options: Required<FeedFetchOptions>): Promise<SourceItem[]> {
  const { response, text, truncated } = await fetchTextWithRetry(
    feed.url,
    {
      headers: {
        accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
        "user-agent": "The Ploradian bot/0.1 (+https://news.ploradian.com/about/)"
      }
    },
    {
      label: `RSS feed ${feed.name}`,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes,
      retries: options.retries
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
  const url = absolutizeUrl(stringValue(record.link) || stringValue(record.guid), feed.url);
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
  const url = absolutizeUrl(atomLink(record.link) || stringValue(record.id), feed.url);
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

function absolutizeUrl(raw: string, base: string): string {
  if (!raw) {
    return "";
  }

  try {
    const baseUrl = new URL(base);
    if (/^[\w.-]+\//.test(raw) && !raw.includes("://")) {
      return new URL(`/${raw}`, baseUrl.origin).toString();
    }
    return new URL(raw, base).toString();
  } catch {
    return raw.trim();
  }
}

export function extractUsefulPageText(html: string, source: SourceItem): string {
  const candidates = [
    ...jsonLdArticleCandidates(html),
    ...siteSpecificCandidates(html, source),
    ...genericContentCandidates(html)
  ]
    .map((candidate) => ({
      ...candidate,
      text: finalizeCandidateText(candidate.text)
    }))
    .filter((candidate) => candidate.text.length >= MIN_USEFUL_PAGE_TEXT_CHARS);

  candidates.sort((left, right) => candidateScore(right, source) - candidateScore(left, source));
  const best = candidates[0];
  if (!best) {
    return "";
  }

  const score = candidateScore(best, source);
  if (score < 28 && source.summary.length >= 80) {
    return "";
  }
  if (isAttachmentOnlyText(best.text)) {
    return "";
  }

  return best.text.slice(0, USEFUL_PAGE_TEXT_MAX_CHARS);
}

function jsonLdArticleCandidates(html: string): TextCandidate[] {
  const candidates: TextCandidate[] = [];
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRegex)) {
    const raw = decodeHtmlEntities(stripJsonScript(match[1] ?? ""));
    const data = parseLooseJson(raw);
    for (const article of articleRecords(data)) {
      const headline = stringValue(article.headline);
      const description = stringValue(article.description);
      const articleBody = stringValue(article.articleBody);
      const text = [headline, description, articleBody].filter(Boolean).join(" ");
      if (text) {
        candidates.push({
          label: articleBody ? "jsonld:articleBody" : "jsonld:description",
          text,
          weight: articleBody ? 34 : 8
        });
      }
    }
  }

  return candidates;
}

function siteSpecificCandidates(html: string, source: SourceItem): TextCandidate[] {
  const hostname = hostnameFor(source.url);
  const candidates: TextCandidate[] = [];

  if (hostname.endsWith("theverge.com")) {
    candidates.push(...tagCandidates(html, "article", 18, "theverge:article"));
    candidates.push(...tagCandidates(html, "main", 12, "theverge:main"));
  } else if (hostname.endsWith("arstechnica.com")) {
    candidates.push(...tagCandidates(html, "article", 22, "ars:article"));
    candidates.push(...tagCandidates(html, "main", 14, "ars:main"));
  } else if (hostname.endsWith("bok.or.kr")) {
    candidates.push(...attributeCandidates(html, /id=["']main-container["']/i, 34, "bok:main-container"));
    candidates.push(...attributeCandidates(html, /id=["']content["']/i, 16, "bok:content"));
  } else if (hostname.endsWith("einfomax.co.kr")) {
    candidates.push(...attributeCandidates(html, /id=["']articleViewCon["']/i, 32, "infomax:articleViewCon"));
    candidates.push(...attributeCandidates(html, /id=["']article-view["']/i, 18, "infomax:article-view"));
    candidates.push(...tagCandidates(html, "article", 12, "infomax:article"));
  } else if (/(?:korea|moel|fsc|nabo)\.go\.kr$/.test(hostname)) {
    candidates.push(...tagCandidates(html, "main", 22, "public:main"));
    candidates.push(...attributeCandidates(html, /id=["'](?:content|contents|container|main-container)["']/i, 18, "public:content"));
    candidates.push(...attributeCandidates(html, /class=["'][^"']*(?:view|board|bbs|content|article|body)[^"']*["']/i, 14, "public:view"));
  } else if (hostname.endsWith("npr.org")) {
    candidates.push(...tagCandidates(html, "article", 20, "npr:article"));
    candidates.push(...tagCandidates(html, "main", 12, "npr:main"));
  }

  return candidates;
}

function genericContentCandidates(html: string): TextCandidate[] {
  return [
    ...tagCandidates(html, "article", 14, "generic:article"),
    ...tagCandidates(html, "main", 10, "generic:main"),
    ...attributeCandidates(
      html,
      new RegExp(`(?:id|class|role)=["'][^"']*${CONTENT_ATTR_PATTERN}[^"']*["']`, "i"),
      6,
      "generic:attr"
    )
  ];
}

function tagCandidates(html: string, tag: (typeof CONTENT_TAGS)[number], weight: number, label: string): TextCandidate[] {
  const candidates: TextCandidate[] = [];
  const regex = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  for (const match of html.matchAll(regex)) {
    const block = extractElementFromStart(html, match.index ?? 0, tag);
    if (block) {
      candidates.push({ label, text: cleanCandidateHtml(block), weight });
    }
  }
  return candidates.slice(0, 8);
}

function attributeCandidates(html: string, attrPattern: RegExp, weight: number, label: string): TextCandidate[] {
  const candidates: TextCandidate[] = [];
  const regex = /<(article|main|section|div)\b[^>]*>/gi;
  for (const match of html.matchAll(regex)) {
    const tag = match[1]?.toLowerCase() as (typeof CONTENT_TAGS)[number] | undefined;
    const openTag = match[0] ?? "";
    if (!tag || !attrPattern.test(openTag)) {
      continue;
    }
    attrPattern.lastIndex = 0;
    const block = extractElementFromStart(html, match.index ?? 0, tag);
    if (block) {
      candidates.push({ label, text: cleanCandidateHtml(block), weight });
    }
  }
  return candidates.slice(0, 10);
}

function extractElementFromStart(html: string, start: number, tag: string): string {
  const regex = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
  regex.lastIndex = start;
  let depth = 0;
  let lastEnd = start;
  for (const match of html.matchAll(regex)) {
    const token = match[0] ?? "";
    lastEnd = (match.index ?? start) + token.length;
    if (token.startsWith("</")) {
      depth -= 1;
      if (depth <= 0) {
        return html.slice(start, lastEnd);
      }
    } else if (!token.endsWith("/>")) {
      depth += 1;
    }
  }

  return html.slice(start, Math.min(html.length, start + 180000));
}

function cleanCandidateHtml(html: string): string {
  return stripHtml(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<(?:nav|footer|aside|form|button|iframe)\b[\s\S]*?<\/(?:nav|footer|aside|form|button|iframe)>/gi, " ")
  );
}

function finalizeCandidateText(value: string): string {
  return truncateAtNoise(
    trimPublicBodyStart(removeNoiseText(decodeHtmlEntities(value)))
      .replace(/\s+/g, " ")
      .trim()
  );
}

function removeNoiseText(value: string): string {
  return value
    .replace(/\[Image:[^\]]+\]/gi, " ")
    .replace(/\bundefined\b/gi, " ")
    .replace(/Credit:\s*[^.]{1,100}(?=\s|$)/gi, " ")
    .replace(/이 기사를 공유합니다/g, " ")
    .replace(/Posts from this (?:topic|author)[^.]*\./gi, " ")
    .replace(/Follow Follow(?: See All [A-Za-z &/]+)?/g, " ")
    .replace(/(?:Text settings\s*)?(?:Story\s*)?text Size Small Standard Large Width \* Standard Wide Links Standard Orange \* Subscribers only Learn more(?: Minimize to nav| Pin to story)?/gi, " ")
    .replace(/Width \* Standard Wide Links Standard Orange \*/gi, " ")
    .replace(/Subscribers only Learn more/gi, " ")
    .replace(/Sign in dialog\.\.\. Sign in/gi, " ")
    .replace(/Skip to (?:main )?content/gi, " ")
    .replace(/Login \/ Sign Up/gi, " ")
    .replace(/Hamburger Navigation Button/gi, " ")
    .replace(/Navigation Drawer/gi, " ")
    .replace(/Close Search/gi, " ")
    .replace(/본문내용 바로가기|주메뉴 바로가기|관련사이트 바로가기/g, " ")
    .replace(/주소\s*복사|RSS복사|새 창으로 열림/g, " ");
}

function trimPublicBodyStart(value: string): string {
  const bodyStart = value.search(/(?:^|\s)(?:□|ㅇ\s|―\s)/);
  if (
    bodyStart > 0 &&
    bodyStart < 700 &&
    /(?:통계보기|첨부파일|뷰어|다운로드)/.test(value.slice(0, bodyStart))
  ) {
    return value.slice(bodyStart).trim();
  }
  return value;
}

function truncateAtNoise(value: string): string {
  let end = value.length;
  for (const marker of TRUNCATE_MARKERS) {
    const index = value.indexOf(marker);
    const minimumIndex = /^(?:목록|유용한|페이지|개인정보|관련기사|기자의|저작권자|무단전재)/.test(marker) ? 80 : 500;
    if (index >= minimumIndex && index < end) {
      end = index;
    }
  }
  return value.slice(0, end).trim();
}

function candidateScore(candidate: TextCandidate, source: SourceItem): number {
  const text = candidate.text;
  const titleTokens = keywordTokens(source.title);
  const summaryTokens = keywordTokens(source.summary);
  const titleHits = overlapCount(text, titleTokens);
  const summaryHits = overlapCount(text, summaryTokens);
  const noiseHits = NOISE_TERMS.reduce((count, term) => count + occurrences(text.toLowerCase(), term.toLowerCase()), 0);
  const sentenceHints = occurrences(text, ".") + occurrences(text, "다.") + occurrences(text, "요.") + occurrences(text, "니다.");
  const numberHits = text.match(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?/g)?.length ?? 0;
  const koreanPublicBodyHints = text.match(/(?:□|ㅇ|―|담당부서|첨부파일|등록일|조회수|보도자료)/g)?.length ?? 0;

  let score = candidate.weight;
  score += Math.min(36, text.length / 90);
  score += Math.min(24, titleHits * 5);
  score += Math.min(18, summaryHits * 3);
  score += Math.min(12, sentenceHints * 2);
  score += Math.min(10, numberHits * 1.5);
  score += Math.min(12, koreanPublicBodyHints * 2);
  score -= noiseHits * 7;

  if (text.length < 300) {
    score -= 10;
  }
  if (text.length > 700 && titleHits === 0 && summaryHits === 0) {
    score -= 18;
  }
  if (/(?:검색|로그인|채용|사이트맵|ENGLISH|The Verge logo|Forum Subscribe|Theme HyperLight).{0,120}(?:검색|로그인|채용|사이트맵|ENGLISH|The Verge logo|Forum Subscribe|Theme HyperLight)/i.test(text)) {
    score -= 18;
  }

  return score;
}

function isAttachmentOnlyText(value: string): boolean {
  return (
    value.length < 500 &&
    /(?:첨부파일|다운로드|통계보기|뷰어)/.test(value) &&
    !/(?:□|ㅇ\s|―\s)/.test(value)
  );
}

function keywordTokens(value: string): string[] {
  return [
    ...new Set(
      decodeHtmlEntities(value)
        .replace(/[^\p{L}\p{N}\s.%$-]/gu, " ")
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 4)
        .slice(0, 14)
    )
  ];
}

function overlapCount(text: string, tokens: string[]): number {
  const normalized = text.toLowerCase();
  return tokens.reduce((count, token) => count + (normalized.includes(token.toLowerCase()) ? 1 : 0), 0);
}

function occurrences(value: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  return value.split(needle).length - 1;
}

function hostnameFor(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function stripJsonScript(value: string): string {
  return value.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
}

function parseLooseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function articleRecords(value: unknown): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const visit = (item: unknown) => {
    const record = asRecord(item);
    if (!record) {
      if (Array.isArray(item)) {
        item.forEach(visit);
      }
      return;
    }

    const type = record["@type"];
    const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
    if (types.some((entry) => /(?:NewsArticle|Article|BlogPosting)/i.test(entry))) {
      output.push(record);
    }

    visit(record["@graph"]);
    visit(record.mainEntity);
  };
  visit(value);
  return output;
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
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
    ndash: "–",
    mdash: "—",
    middot: "·"
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
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

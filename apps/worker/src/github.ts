import { fromBase64Utf8 } from "./crypto";
import { fetchTextWithRetry, HttpError } from "./http";
import type {
  GitHubTarget,
  MarketHistoryEntry,
  MarketHistoryStore,
  PreparedArticle,
  SeenStore,
  SeriousEditorialEntry,
  SeriousEditorialStore
} from "./types";

interface GitHubRef {
  object: {
    sha: string;
  };
}

interface GitHubCommit {
  sha: string;
  tree: {
    sha: string;
  };
}

interface GitHubBlob {
  sha: string;
}

interface GitHubTree {
  sha: string;
}

interface GitHubContentFile {
  type: string;
  content?: string;
}

const API_ROOT = "https://api.github.com";
const SEEN_PATH = "content/sources/seen.json";
const SERIOUS_EDITORIAL_PATH = "content/sources/serious-editorial.json";
const MARKET_HISTORY_PATH = "content/sources/market-history.json";

export async function readSeenStore(target: GitHubTarget): Promise<SeenStore> {
  try {
    const file = await githubJson<GitHubContentFile>(
      target,
      `/repos/${repoPath(target)}/contents/${encodePath(SEEN_PATH)}?ref=${encodeURIComponent(target.branch)}`,
      "read seen.json"
    );

    if (file.type !== "file" || typeof file.content !== "string") {
      return emptySeenStore();
    }

    return normalizeSeenStore(JSON.parse(fromBase64Utf8(file.content)));
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return emptySeenStore();
    }
    throw error;
  }
}

export async function readSeriousEditorialStore(target: GitHubTarget): Promise<SeriousEditorialStore> {
  try {
    const file = await githubJson<GitHubContentFile>(
      target,
      `/repos/${repoPath(target)}/contents/${encodePath(SERIOUS_EDITORIAL_PATH)}?ref=${encodeURIComponent(target.branch)}`,
      "read serious-editorial.json"
    );

    if (file.type !== "file" || typeof file.content !== "string") {
      return emptySeriousEditorialStore();
    }

    return normalizeSeriousEditorialStore(JSON.parse(fromBase64Utf8(file.content)));
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return emptySeriousEditorialStore();
    }
    throw error;
  }
}

export async function readMarketHistoryStore(target: GitHubTarget): Promise<MarketHistoryStore> {
  try {
    const file = await githubJson<GitHubContentFile>(
      target,
      `/repos/${repoPath(target)}/contents/${encodePath(MARKET_HISTORY_PATH)}?ref=${encodeURIComponent(target.branch)}`,
      "read market-history.json"
    );

    if (file.type !== "file" || typeof file.content !== "string") {
      return emptyMarketHistoryStore();
    }

    return normalizeMarketHistoryStore(JSON.parse(fromBase64Utf8(file.content)));
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return emptyMarketHistoryStore();
    }
    throw error;
  }
}

export async function githubPathExists(target: GitHubTarget, path: string): Promise<boolean> {
  try {
    await githubJson<GitHubContentFile>(
      target,
      `/repos/${repoPath(target)}/contents/${encodePath(path)}?ref=${encodeURIComponent(target.branch)}`,
      `check path ${path}`
    );
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

export async function commitGeneratedArticles(
  target: GitHubTarget,
  articles: PreparedArticle[],
  seenStore: SeenStore,
  seriousEditorialStore?: SeriousEditorialStore,
  marketHistoryStore?: MarketHistoryStore
): Promise<string> {
  const ref = await githubJson<GitHubRef>(
    target,
    `/repos/${repoPath(target)}/git/ref/heads/${target.branch}`,
    "read branch ref"
  );
  const headCommit = await githubJson<GitHubCommit>(
    target,
    `/repos/${repoPath(target)}/git/commits/${ref.object.sha}`,
    "read head commit"
  );

  const files = [
    ...articles.map((article) => ({ path: article.path, content: article.markdown })),
    {
      path: SEEN_PATH,
      content: `${JSON.stringify(seenStore, null, 2)}\n`
    },
    ...(seriousEditorialStore
      ? [
          {
            path: SERIOUS_EDITORIAL_PATH,
            content: `${JSON.stringify(seriousEditorialStore, null, 2)}\n`
          }
        ]
      : []),
    ...(marketHistoryStore
      ? [
          {
            path: MARKET_HISTORY_PATH,
            content: `${JSON.stringify(marketHistoryStore, null, 2)}\n`
          }
        ]
      : [])
  ];

  const blobs = await Promise.all(
    files.map((file) =>
      githubJson<GitHubBlob>(
        target,
        `/repos/${repoPath(target)}/git/blobs`,
        `create blob ${file.path}`,
        {
          method: "POST",
          body: JSON.stringify({
            content: file.content,
            encoding: "utf-8"
          })
        }
      )
    )
  );

  const tree = await githubJson<GitHubTree>(
    target,
    `/repos/${repoPath(target)}/git/trees`,
    "create tree",
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: headCommit.tree.sha,
        tree: files.map((file, index) => ({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: blobs[index]?.sha
        }))
      })
    }
  );

  const message =
    articles.length === 1
      ? `publish: add satire article about ${articles[0]?.topic ?? "latest news"}`
      : `publish: add satire articles about ${articles.map((article) => article.topic).join(", ")}`;

  const newCommit = await githubJson<GitHubCommit>(
    target,
    `/repos/${repoPath(target)}/git/commits`,
    "create commit",
    {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: tree.sha,
        parents: [ref.object.sha]
      })
    }
  );

  await githubJson<GitHubRef>(
    target,
    `/repos/${repoPath(target)}/git/refs/heads/${target.branch}`,
    "update branch ref",
    {
      method: "PATCH",
      body: JSON.stringify({
        sha: newCommit.sha,
        force: false
      })
    }
  );

  return newCommit.sha;
}

export function addSeenItems(
  store: SeenStore,
  articles: PreparedArticle[],
  now = new Date()
): SeenStore {
  const updated: SeenStore = {
    version: 1,
    updated_at: now.toISOString(),
    items: { ...store.items }
  };

  for (const article of articles) {
    updated.items[article.sourceHash] = {
      url: article.source_url,
      canonical_url: article.source_url,
      source_name: article.source_name,
      title: article.original_title,
      article_path: article.path,
      seen_at: now.toISOString()
    };
  }

  return updated;
}

export function emptySeenStore(): SeenStore {
  return {
    version: 1,
    updated_at: null,
    items: {}
  };
}

export function addSeriousEditorialEntries(
  store: SeriousEditorialStore,
  entries: SeriousEditorialEntry[],
  now = new Date()
): SeriousEditorialStore {
  if (entries.length === 0) {
    return store;
  }

  return {
    version: 1,
    updated_at: now.toISOString(),
    recent: [...entries, ...store.recent].slice(0, 40)
  };
}

export function emptySeriousEditorialStore(): SeriousEditorialStore {
  return {
    version: 1,
    updated_at: null,
    recent: []
  };
}

export function addMarketHistoryEntries(
  store: MarketHistoryStore,
  entries: MarketHistoryEntry[],
  now = new Date()
): MarketHistoryStore {
  if (entries.length === 0) {
    return store;
  }

  const keyed = new Map<string, MarketHistoryEntry>();
  for (const entry of [...entries, ...store.recent]) {
    keyed.set(`${entry.market}:${entry.date}:${entry.source_url}`, entry);
  }

  return {
    version: 1,
    updated_at: now.toISOString(),
    recent: [...keyed.values()].slice(0, 30)
  };
}

export function emptyMarketHistoryStore(): MarketHistoryStore {
  return {
    version: 1,
    updated_at: null,
    recent: []
  };
}

async function githubJson<T>(
  target: GitHubTarget,
  path: string,
  label: string,
  init: RequestInit = {}
): Promise<T> {
  const { response, text } = await fetchTextWithRetry(
    `${API_ROOT}${path}`,
    {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
        "user-agent": "the-ploradian-worker",
        "x-github-api-version": "2022-11-28",
        ...init.headers
      }
    },
    {
      label,
      timeoutMs: 15000,
      maxBytes: 131072,
      retries: 2
    }
  );

  if (!response.ok) {
    throw new HttpError(`${label} failed with HTTP ${response.status}`, response.status, text);
  }

  return JSON.parse(text) as T;
}

function normalizeSeenStore(value: unknown): SeenStore {
  if (!value || typeof value !== "object") {
    return emptySeenStore();
  }

  const record = value as Record<string, unknown>;
  if (record.version === 1 && record.items && typeof record.items === "object") {
    return {
      version: 1,
      updated_at: typeof record.updated_at === "string" ? record.updated_at : null,
      items: record.items as SeenStore["items"]
    };
  }

  return emptySeenStore();
}

function normalizeSeriousEditorialStore(value: unknown): SeriousEditorialStore {
  if (!value || typeof value !== "object") {
    return emptySeriousEditorialStore();
  }

  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.recent)) {
    return emptySeriousEditorialStore();
  }

  return {
    version: 1,
    updated_at: typeof record.updated_at === "string" ? record.updated_at : null,
    recent: record.recent
      .map(normalizeSeriousEditorialEntry)
      .filter((entry): entry is SeriousEditorialEntry => entry !== null)
      .slice(0, 40)
  };
}

function normalizeMarketHistoryStore(value: unknown): MarketHistoryStore {
  if (!value || typeof value !== "object") {
    return emptyMarketHistoryStore();
  }

  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.recent)) {
    return emptyMarketHistoryStore();
  }

  return {
    version: 1,
    updated_at: typeof record.updated_at === "string" ? record.updated_at : null,
    recent: record.recent
      .map(normalizeMarketHistoryEntry)
      .filter((entry): entry is MarketHistoryEntry => entry !== null)
      .slice(0, 30)
  };
}

function normalizeMarketHistoryEntry(value: unknown): MarketHistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const market = stringValue(record.market);
  const date = stringValue(record.date);
  const title = stringValue(record.title);
  const sourceUrl = stringValue(record.source_url);
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map(normalizeMarketHistoryRow)
        .filter((row): row is MarketHistoryEntry["rows"][number] => row !== null)
    : [];

  if ((market !== "국장" && market !== "미장") || !date || !title || !sourceUrl || rows.length === 0) {
    return null;
  }

  return { market, date, title, source_url: sourceUrl, rows };
}

function normalizeMarketHistoryRow(value: unknown): MarketHistoryEntry["rows"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = stringValue(record.name);
  const symbol = stringValue(record.symbol);
  const price = stringValue(record.price);
  const change = stringValue(record.change);
  if (!name || !symbol || !price || !change) {
    return null;
  }

  return {
    name,
    symbol,
    price,
    change,
    business: stringValue(record.business) || "업종 단서 없음",
    jokeSeed: stringValue(record.jokeSeed) || name
  };
}

function normalizeSeriousEditorialEntry(value: unknown): SeriousEditorialEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const date = stringValue(record.date);
  const axis = stringValue(record.axis);
  const institution = stringValue(record.institution);
  const angleType = stringValue(record.angle_type);
  const title = stringValue(record.title);
  const sourceUrl = stringValue(record.source_url);
  if (!date || !axis || !institution || !angleType || !title || !sourceUrl) {
    return null;
  }

  return {
    date,
    axis: axis as SeriousEditorialEntry["axis"],
    institution,
    angle_type: angleType,
    title,
    source_url: sourceUrl
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function repoPath(target: GitHubTarget): string {
  return target.repo
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

import { fromBase64Utf8 } from "./crypto";
import { fetchTextWithRetry, HttpError } from "./http";
import type { GitHubTarget, PreparedArticle, SeenStore } from "./types";

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

export async function readSeenStore(target: GitHubTarget): Promise<SeenStore> {
  try {
    const file = await githubJson<GitHubContentFile>(
      target,
      `/repos/${repoPath(target)}/contents/${encodePath("content/sources/seen.json")}?ref=${encodeURIComponent(target.branch)}`,
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
  seenStore: SeenStore
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
      path: "content/sources/seen.json",
      content: `${JSON.stringify(seenStore, null, 2)}\n`
    }
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

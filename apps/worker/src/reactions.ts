import { sha256Hex } from "./crypto";

const reactionKinds = ["heart", "laugh", "spicy", "tip"] as const;

type ReactionKind = (typeof reactionKinds)[number];
type ReactionCounts = Record<ReactionKind, number>;

const emptyCounts: ReactionCounts = {
  heart: 0,
  laugh: 0,
  spicy: 0,
  tip: 0
};

const maxBodyBytes = 2048;
const duplicateTtlSeconds = 60 * 60 * 24 * 2;

interface ReactionEnv {
  REACTIONS?: KVNamespace;
}

interface ReactionPostBody {
  slug?: unknown;
  reaction?: unknown;
}

export async function handleReactionRequest(request: Request, env: ReactionEnv): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: reactionHeaders() });
  }

  if (!env.REACTIONS) {
    return reactionJson({ ok: false, error: "Reactions are not configured" }, 503);
  }

  const url = new URL(request.url);

  if (request.method === "GET") {
    const slug = normalizeSlug(url.searchParams.get("slug"));
    if (!slug) {
      return reactionJson({ ok: false, error: "Invalid slug" }, 400);
    }

    return reactionJson({ ok: true, slug, counts: await readCounts(env.REACTIONS, slug) }, 200);
  }

  if (request.method !== "POST") {
    return reactionJson({ ok: false, error: "Method not allowed" }, 405, { allow: "GET, POST, OPTIONS" });
  }

  if (!isSameSite(request)) {
    return reactionJson({ ok: false, error: "Forbidden" }, 403);
  }

  const body = await readSmallJson(request);
  if (!body) {
    return reactionJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const slug = normalizeSlug(body.slug);
  const reaction = normalizeReaction(body.reaction);
  if (!slug || !reaction) {
    return reactionJson({ ok: false, error: "Invalid reaction" }, 400);
  }

  const duplicateKey = await dailyDuplicateKey(request, slug, reaction);
  const duplicate = await env.REACTIONS.get(duplicateKey);
  if (duplicate) {
    return reactionJson({
      ok: true,
      slug,
      reaction,
      counted: false,
      duplicate: true,
      counts: await readCounts(env.REACTIONS, slug)
    }, 200);
  }

  const counts = await readCounts(env.REACTIONS, slug);
  counts[reaction] += 1;

  await Promise.all([
    env.REACTIONS.put(countsKey(slug), JSON.stringify(counts)),
    env.REACTIONS.put(duplicateKey, "1", { expirationTtl: duplicateTtlSeconds })
  ]);

  return reactionJson({ ok: true, slug, reaction, counted: true, duplicate: false, counts }, 200);
}

function normalizeSlug(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const slug = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(slug)) {
    return null;
  }

  return slug;
}

function normalizeReaction(value: unknown): ReactionKind | null {
  if (typeof value !== "string") {
    return null;
  }

  return reactionKinds.includes(value as ReactionKind) ? (value as ReactionKind) : null;
}

async function readSmallJson(request: Request): Promise<ReactionPostBody | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return null;
  }

  const raw = await request.text();
  if (raw.length > maxBodyBytes) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as ReactionPostBody : null;
  } catch {
    return null;
  }
}

async function readCounts(kv: KVNamespace, slug: string): Promise<ReactionCounts> {
  const raw = await kv.get(countsKey(slug), "json");
  if (!raw || typeof raw !== "object") {
    return { ...emptyCounts };
  }

  const record = raw as Partial<Record<ReactionKind, unknown>>;
  return {
    heart: normalizeCount(record.heart),
    laugh: normalizeCount(record.laugh),
    spicy: normalizeCount(record.spicy),
    tip: normalizeCount(record.tip)
  };
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function countsKey(slug: string): string {
  return `reaction:counts:${slug}`;
}

async function dailyDuplicateKey(request: Request, slug: string, reaction: ReactionKind): Promise<string> {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const hash = await sha256Hex(`${day}|${ip}|${userAgent}|${slug}|${reaction}`);

  return `reaction:daily:${day}:${slug}:${reaction}:${hash.slice(0, 32)}`;
}

function isSameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      return host === "news.ploradian.com" || host === "127.0.0.1" || host === "localhost";
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return false;
  }

  try {
    const host = new URL(referer).hostname;
    return host === "news.ploradian.com" || host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

function reactionJson(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: reactionHeaders(headers)
  });
}

function reactionHeaders(headers: Record<string, string> = {}): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  };
}

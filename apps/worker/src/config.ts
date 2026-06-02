import type { AiProvider, FeedSource, GitHubTarget, RuntimeConfig, WorkersAiBinding } from "./types";

const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_PROVIDER: AiProvider = "openai";
const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_BRANCH = "main";
const DEFAULT_TIMEZONE = "Asia/Seoul";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Env): RuntimeConfig {
  const values = env as unknown as Record<string, string | undefined>;
  const aiProvider = parseAiProvider(values.AI_PROVIDER);
  const openaiApiKey =
    aiProvider === "openai" ? requiredSecret(values, "OPENAI_API_KEY") : clean(values.OPENAI_API_KEY);
  const openaiModel = clean(values.OPENAI_MODEL) ?? DEFAULT_MODEL;
  const workersAiModel = clean(values.WORKERS_AI_MODEL) ?? DEFAULT_WORKERS_AI_MODEL;
  const workersAi = aiProvider === "workers-ai" ? requireWorkersAiBinding(env) : null;
  const generationModel = aiProvider === "workers-ai" ? `workers-ai:${workersAiModel}` : openaiModel;
  const githubRepo = clean(values.GITHUB_REPO) ?? "";
  const githubBranch = clean(values.GITHUB_BRANCH) ?? DEFAULT_BRANCH;
  const githubToken = clean(values.GITHUB_TOKEN) ?? null;
  const rssFeeds = parseFeeds(values.RSS_FEEDS_JSON);
  const maxArticlesPerRun = parseInteger(values.MAX_ARTICLES_PER_RUN, 2, 1, 5);
  const dryRun = parseBoolean(values.DRY_RUN, false);
  const siteTimezone = clean(values.SITE_TIMEZONE) ?? DEFAULT_TIMEZONE;
  const unsplashAccessKey = clean(values.UNSPLASH_ACCESS_KEY);

  if (rssFeeds.length === 0) {
    throw new ConfigError("RSS_FEEDS_JSON must contain at least one feed.");
  }

  return {
    aiProvider,
    openaiApiKey,
    openaiModel,
    workersAiModel,
    workersAi,
    generationModel,
    githubRepo,
    githubBranch,
    githubToken,
    rssFeeds,
    maxArticlesPerRun,
    dryRun,
    siteTimezone,
    unsplashAccessKey
  };
}

export function requireGitHubTarget(config: RuntimeConfig): GitHubTarget {
  if (!config.githubToken) {
    throw new ConfigError("GITHUB_TOKEN is required when DRY_RUN=false.");
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(config.githubRepo) || config.githubRepo === "owner/repo") {
    throw new ConfigError("GITHUB_REPO must be configured as owner/repo.");
  }

  return {
    token: config.githubToken,
    repo: config.githubRepo,
    branch: config.githubBranch
  };
}

function requiredSecret(values: Record<string, string | undefined>, key: string): string {
  const value = clean(values[key]);
  if (!value) {
    throw new ConfigError(`${key} is required.`);
  }
  return value;
}

function parseAiProvider(raw: string | undefined): AiProvider {
  const value = clean(raw)?.toLowerCase();
  if (!value) {
    return DEFAULT_PROVIDER;
  }

  if (value === "openai" || value === "workers-ai") {
    return value;
  }

  if (value === "workers_ai" || value === "cloudflare" || value === "cloudflare-workers-ai") {
    return "workers-ai";
  }

  throw new ConfigError("AI_PROVIDER must be openai or workers-ai.");
}

function requireWorkersAiBinding(env: Env): WorkersAiBinding {
  const binding = (env as unknown as { AI?: unknown }).AI;
  if (!binding || typeof binding !== "object" || typeof (binding as { run?: unknown }).run !== "function") {
    throw new ConfigError("Workers AI binding AI is required when AI_PROVIDER=workers-ai.");
  }

  return binding as WorkersAiBinding;
}

function parseFeeds(raw: string | undefined): FeedSource[] {
  const value = clean(raw);
  if (!value) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new ConfigError(`RSS_FEEDS_JSON is not valid JSON: ${errorMessage(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new ConfigError("RSS_FEEDS_JSON must be a JSON array.");
  }

  return parsed.map((entry, index) => normalizeFeed(entry, index));
}

function normalizeFeed(entry: unknown, index: number): FeedSource {
  if (!entry || typeof entry !== "object") {
    throw new ConfigError(`Feed at index ${index} must be an object.`);
  }

  const record = entry as Record<string, unknown>;
  const name = stringField(record, "name", index);
  const url = stringField(record, "url", index);
  const category = stringField(record, "category", index);

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ConfigError(`Feed URL at index ${index} must be HTTP or HTTPS.`);
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(`Feed URL at index ${index} is invalid.`);
  }

  return { name, url, category };
}

function stringField(record: Record<string, unknown>, key: string, index: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`Feed at index ${index} is missing "${key}".`);
  }
  return value.trim();
}

function parseInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const value = clean(raw);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`MAX_ARTICLES_PER_RUN must be between ${min} and ${max}.`);
  }
  return parsed;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  const value = clean(raw);
  if (!value) {
    return fallback;
  }
  if (["true", "1", "yes"].includes(value.toLowerCase())) {
    return true;
  }
  if (["false", "0", "no"].includes(value.toLowerCase())) {
    return false;
  }
  throw new ConfigError("DRY_RUN must be true or false.");
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

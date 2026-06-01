export interface FeedSource {
  name: string;
  url: string;
  category: string;
}

export interface GitHubTarget {
  token: string;
  repo: string;
  branch: string;
}

export type AiProvider = "openai" | "workers-ai";

export interface WorkersAiBinding {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface RuntimeConfig {
  aiProvider: AiProvider;
  openaiApiKey: string | null;
  openaiModel: string;
  workersAiModel: string;
  workersAi: WorkersAiBinding | null;
  generationModel: string;
  githubRepo: string;
  githubBranch: string;
  githubToken: string | null;
  rssFeeds: FeedSource[];
  maxArticlesPerRun: number;
  dryRun: boolean;
  siteTimezone: string;
}

export interface SourceItem {
  feedName: string;
  feedUrl: string;
  category: string;
  title: string;
  url: string;
  canonicalUrl: string;
  summary: string;
  publishedAt?: string;
}

export interface FactSummary {
  entities: string[];
  numbers: string[];
  dates: string[];
  conflict_or_controversy: string;
  money_stock_market_angle: string;
  reader_relevance: string;
  facts: string[];
}

export interface GeneratedArticleJson {
  title: string;
  subtitle: string;
  category: string;
  slug: string;
  body: string;
  source_name: string;
  source_url: string;
  original_title: string;
}

export interface PreparedArticle {
  title: string;
  subtitle: string;
  slug: string;
  date: string;
  category: string;
  source_name: string;
  source_url: string;
  original_title: string;
  generated_by: string;
  status: "published";
  body: string;
  path: string;
  markdown: string;
  sourceHash: string;
  topic: string;
}

export interface SeenItem {
  url: string;
  canonical_url: string;
  source_name: string;
  title: string;
  article_path: string;
  seen_at: string;
}

export interface SeenStore {
  version: 1;
  updated_at: string | null;
  items: Record<string, SeenItem>;
}

export interface PipelineResult {
  ok: boolean;
  trigger: "manual" | "scheduled";
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  generated: number;
  committed: boolean;
  skipped: string[];
  errors: string[];
  articles?: Array<{
    path: string;
    title: string;
    markdown?: string;
  }>;
}

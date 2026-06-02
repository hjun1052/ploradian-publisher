export interface FeedSource {
  name: string;
  url: string;
  category: string;
}

export type SeriousAxis = "노동" | "생활경제" | "기업" | "규제/감시" | "정책";
export type SeriousSourceKind = "rss" | "sitemap" | "watch";

export interface SeriousSource extends FeedSource {
  axis: SeriousAxis;
  kind: SeriousSourceKind;
  institution?: string;
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
  seriousSources: SeriousSource[];
  seriousMinScore: number;
  maxArticlesPerRun: number;
  dryRun: boolean;
  siteTimezone: string;
  unsplashAccessKey: string | null;
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
  synthetic?: boolean;
  seriousAxis?: SeriousAxis;
  seriousKind?: SeriousSourceKind;
  seriousInstitution?: string;
  seriousEvaluation?: SeriousCandidateEvaluation;
}

export interface SeriousCandidateEvaluation {
  raw_score: number;
  final_score: number;
  axis: SeriousAxis;
  institution: string;
  angle_type: string;
  angle: string;
  who_benefits: string;
  who_pays: string;
  hidden_cost: string;
  missing_question: string;
  publish_decision: "publish" | "hold" | "reject";
  reasoning_note: string;
}

export interface FactSummary {
  entities: string[];
  numbers: string[];
  dates: string[];
  conflict_or_controversy: string;
  money_stock_market_angle: string;
  reader_relevance: string;
  satire_targets: string[];
  mockable_details: string[];
  weak_points: string[];
  corporate_euphemisms: string[];
  facts: string[];
}

export interface GeneratedArticleJson {
  title: string;
  subtitle: string;
  category: string;
  slug: string;
  satire_brief: SatireBrief;
  body: string;
  source_name: string;
  source_url: string;
  original_title: string;
}

export interface SatireBrief {
  target: string;
  ridiculous_core: string;
  straight_faced_defense: string[];
  must_include_jabs: string[];
  analogies: string[];
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
  image_url?: string;
  image_alt?: string;
  image_credit_name?: string;
  image_credit_url?: string;
  body: string;
  path: string;
  markdown: string;
  sourceHash: string;
  topic: string;
  seriousEvaluation?: SeriousCandidateEvaluation;
}

export interface ArticleImage {
  url: string;
  alt: string;
  creditName: string;
  creditUrl: string;
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

export interface SeriousEditorialEntry {
  date: string;
  axis: SeriousAxis;
  institution: string;
  angle_type: string;
  title: string;
  source_url: string;
}

export interface SeriousEditorialStore {
  version: 1;
  updated_at: string | null;
  recent: SeriousEditorialEntry[];
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
  serious_editorial?: {
    selected: SeriousCandidateEvaluation | null;
    top_candidates: SeriousCandidateEvaluation[];
    reason: string;
  };
}

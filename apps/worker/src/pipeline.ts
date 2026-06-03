import { ConfigError, loadConfig, requireGitHubTarget } from "./config";
import {
  addMarketHistoryEntries,
  addSeriousEditorialEntries,
  addSeenItems,
  commitGeneratedArticles,
  emptyMarketHistoryStore,
  emptySeriousEditorialStore,
  emptySeenStore,
  githubPathExists,
  readMarketHistoryStore,
  readSeriousEditorialStore,
  readSeenStore
} from "./github";
import { prepareMarkdownArticle } from "./markdown";
import { findArticleImage } from "./images";
import { candidateSkipReason, satireSuitabilitySkipReason } from "./candidates";
import { forcedMarketCandidate, marketHistoryEntryFromSource, scheduledMarketCandidate } from "./market";
import { scheduledNonsenseCandidate } from "./nonsense";
import { scheduledSeriousSelection } from "./serious";
import { scheduledSecurityPreySelection } from "./security";
import { extractFacts, generateSatireArticle, generateSeriousArticle, intensifySatireArticle } from "./ai";
import { fetchFeedItems, fetchSourcePageText, sourceHash } from "./rss";
import { validateGeneratedArticle } from "./validation";
import type {
  FactSummary,
  GeneratedArticleJson,
  PipelineResult,
  PreparedArticle,
  SeenStore,
  SeriousCandidateEvaluation,
  SeriousEditorialEntry,
  FeedSource,
  SourceItem
} from "./types";

export async function runPublishingPipeline(
  env: Env,
  options: {
    trigger: "manual" | "scheduled";
    dryRunOverride?: boolean;
    forceMarket?: "korea" | "us";
    forceSerious?: boolean;
    forceSecurity?: boolean;
    ignoreSeen?: boolean;
  }
): Promise<PipelineResult> {
  const startedAt = new Date().toISOString();
  const skipped: string[] = [];
  const errors: string[] = [];
  const prepared: PreparedArticle[] = [];
  const preparedSources = new Map<string, SourceItem>();
  let seriousEditorial: NonNullable<PipelineResult["serious_editorial"]> = {
    selected: null,
    top_candidates: [],
    reason: "not evaluated"
  };
  let securityPrey: NonNullable<PipelineResult["security_prey"]> = {
    selected: null,
    top_candidates: [],
    reason: "not evaluated"
  };
  let dryRun = false;

  try {
    const config = loadConfig(env);
    dryRun = options.dryRunOverride ?? config.dryRun;
    const githubTarget = dryRun && options.ignoreSeen ? null : requireGitHubTarget(config);
    const seen = githubTarget && !options.ignoreSeen ? await readSeenStore(githubTarget) : emptySeenStore();
    const marketHistory = githubTarget && !options.ignoreSeen
      ? await readMarketHistoryStore(githubTarget)
      : emptyMarketHistoryStore();
    const seriousHistory = githubTarget && !options.ignoreSeen
      ? await readSeriousEditorialStore(githubTarget)
      : emptySeriousEditorialStore();
    const market = options.forceSerious
      ? null
      : options.forceMarket
      ? await forcedMarketCandidate(options.forceMarket, new Date(startedAt), config.siteTimezone, marketHistory)
      : await scheduledMarketCandidate(new Date(startedAt), config.siteTimezone, seen, marketHistory);
    const nonsense = options.forceSerious ? null : scheduledNonsenseCandidate(new Date(startedAt), config.siteTimezone);
    const securitySelection = options.forceSerious
      ? {
          source: null,
          selected: null,
          topCandidates: [],
          reason: "skipped during serious-only run"
        }
      : await scheduledSecurityPreySelection(config, seen, new Date(startedAt), Boolean(options.forceSecurity));
    securityPrey = {
      selected: securitySelection.selected,
      top_candidates: securitySelection.topCandidates,
      reason: securitySelection.reason
    };
    const seriousSelection = await scheduledSeriousSelection(
      config,
      seen,
      seriousHistory,
      new Date(startedAt),
      Boolean(options.forceSerious)
    );
    seriousEditorial = {
      selected: seriousSelection.selected,
      top_candidates: seriousSelection.topCandidates,
      reason: seriousSelection.reason
    };
    const seriousOnlyRun = Boolean(options.forceSerious) || seriousSelection.reason !== "not serious desk slot";
    const scheduledFeeds = seriousOnlyRun ? [] : scheduledFeedSources(config.rssFeeds, new Date(startedAt), config.siteTimezone);
    if (!seriousOnlyRun) {
      skipped.push(`rss window: ${feedWindowName(new Date(startedAt), config.siteTimezone)} (${scheduledFeeds.map((feed) => feed.name).join(", ") || "no rss"})`);
      skipped.push(`security prey: ${securitySelection.reason}`);
    }
    const feedItems = scheduledFeeds.length === 0 ? [] : await fetchFeedItems(scheduledFeeds);
    const scheduledItems = [market, nonsense, securitySelection.source, seriousSelection.source].filter((item): item is SourceItem => item !== null);
    const nonSecurityScheduledItems = [market, nonsense, seriousSelection.source].filter((item): item is SourceItem => item !== null);
    const sourceItems = prioritizeSourceItems([...scheduledItems, ...feedItems]);
    const candidates = await unseenCandidates(filterSourceCandidates(sourceItems, skipped), seen);
    if (candidates.length === 0) {
      skipped.push("no unseen source candidates after filtering and seen-store dedupe");
    }
    const securityExtraSlots = securitySelection.source ? 1 : 0;
    const maxArticlesThisRun = config.maxArticlesPerRun + securityExtraSlots + Math.max(nonSecurityScheduledItems.length - 1, 0);
    const candidateAttemptLimit = scheduledItems.length > 0
      ? Math.max(maxArticlesThisRun * 3, scheduledItems.length)
      : Math.max(config.maxArticlesPerRun * 6, 6);
    const runDeadlineMs = Date.now() + 240_000;

    for (const candidate of candidates.slice(0, candidateAttemptLimit)) {
      if (prepared.length >= maxArticlesThisRun) {
        break;
      }

      if (Date.now() > runDeadlineMs) {
        skipped.push("run time budget reached before the next candidate");
        break;
      }

      try {
        const hash = await sourceHash(candidate);
        const pageText = await fetchSourcePageText(candidate);
        const suitabilityReason = satireSuitabilitySkipReason(candidate, pageText);
        if (suitabilityReason) {
          skipped.push(`source skipped (${suitabilityReason}): ${candidate.title}`);
          continue;
        }
        const facts = await extractFactsWithFallback(config, candidate, pageText);
        const article = await generateAndValidate(config, candidate, facts, pageText);
        const image = await findArticleImage(config, candidate, article, facts);
        const markdownArticle = prepareMarkdownArticle(article, candidate, hash, config, new Date(), image);

        if (githubTarget && (await githubPathExists(githubTarget, markdownArticle.path))) {
          skipped.push(`article path already exists: ${markdownArticle.path}`);
          continue;
        }

        prepared.push(markdownArticle);
        preparedSources.set(markdownArticle.path, candidate);
      } catch (error) {
        const message = `${candidate.title}: ${errorMessage(error)}`;
        errors.push(message);
        console.warn(JSON.stringify({ event: "candidate_failed", message }));
      }
    }

    if (prepared.length === 0) {
      return finish({
        ok: true,
        trigger: options.trigger,
        dryRun,
        startedAt,
        generated: 0,
        committed: false,
        skipped,
        errors,
        articles: [],
        serious_editorial: seriousEditorial,
        security_prey: securityPrey
      });
    }

    if (dryRun) {
      return finish({
        ok: true,
        trigger: options.trigger,
        dryRun,
        startedAt,
        generated: prepared.length,
        committed: false,
        skipped,
        errors,
        articles: prepared.map((article) => ({
          path: article.path,
          title: article.title,
          markdown: article.markdown
        })),
        serious_editorial: seriousEditorial,
        security_prey: securityPrey
      });
    }

    const target = requireGitHubTarget(config);
    const latestSeen = await readSeenStore(target);
    const publishable = await filterPublishableArticles(target, prepared, latestSeen, skipped);

    if (publishable.length === 0) {
      return finish({
        ok: true,
        trigger: options.trigger,
        dryRun,
        startedAt,
        generated: 0,
        committed: false,
        skipped,
        errors,
        articles: [],
        serious_editorial: seriousEditorial,
        security_prey: securityPrey
      });
    }

    const nextSeen = addSeenItems(latestSeen, publishable);
    const seriousEntries = publishable.map(seriousEditorialEntry).filter((entry): entry is SeriousEditorialEntry => entry !== null);
    const marketEntries = publishable
      .map((article) => preparedSources.get(article.path))
      .map((source) => (source ? marketHistoryEntryFromSource(source) : null))
      .filter((entry): entry is NonNullable<ReturnType<typeof marketHistoryEntryFromSource>> => entry !== null);
    const latestSeriousHistory = seriousEntries.length > 0 ? await readSeriousEditorialStore(target) : null;
    const nextSeriousHistory = latestSeriousHistory
      ? addSeriousEditorialEntries(latestSeriousHistory, seriousEntries)
      : undefined;
    const latestMarketHistory = marketEntries.length > 0 ? await readMarketHistoryStore(target) : null;
    const nextMarketHistory = latestMarketHistory
      ? addMarketHistoryEntries(latestMarketHistory, marketEntries)
      : undefined;
    const commitSha = await commitGeneratedArticles(target, publishable, nextSeen, nextSeriousHistory, nextMarketHistory);
    console.log(JSON.stringify({ event: "github_commit_created", commitSha, count: publishable.length }));

    return finish({
      ok: true,
      trigger: options.trigger,
      dryRun,
      startedAt,
      generated: publishable.length,
      committed: true,
      skipped,
      errors,
      articles: publishable.map((article) => ({
        path: article.path,
        title: article.title
      })),
      serious_editorial: seriousEditorial,
      security_prey: securityPrey
    });
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : errorMessage(error);
    errors.push(message);
    return finish({
      ok: false,
      trigger: options.trigger,
      dryRun,
      startedAt,
      generated: prepared.length,
      committed: false,
      skipped,
      errors,
      articles: prepared.map((article) => ({
        path: article.path,
        title: article.title
      })),
      serious_editorial: seriousEditorial,
      security_prey: securityPrey
    });
  }
}

function filterSourceCandidates(items: SourceItem[], skipped: string[]): SourceItem[] {
  return items.filter((item) => {
    const reason = candidateSkipReason(item);
    if (!reason) {
      return true;
    }

    skipped.push(`source skipped (${reason}): ${item.title}`);
    return false;
  });
}

function prioritizeSourceItems(items: SourceItem[]): SourceItem[] {
  return [...items].sort((left, right) => {
    const priorityDiff = sourcePriority(left) - sourcePriority(right);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
    const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

function sourcePriority(source: SourceItem): number {
  if (source.synthetic) {
    return 0;
  }

  if (source.securityPreyEvaluation || source.feedName.includes("보안뉴스")) {
    return 4;
  }

  const feedName = source.feedName.toLowerCase();
  const text = `${source.feedName} ${source.title} ${source.summary}`.toLowerCase();
  if (feedName.includes("채권/외환") || /(irs|fx스와프|국채선물|채권-|외환-|달러-원)/i.test(text)) {
    return 80;
  }

  if (feedName.includes("the verge") || feedName.includes("ars technica")) {
    return 10;
  }

  if (feedName.includes("ib/기업") || feedName.includes("해외주식") || feedName.includes("증권")) {
    return 15;
  }

  if (source.category === "비즈니스") {
    return 20;
  }

  if (source.category === "기술") {
    return 25;
  }

  if (source.category === "시장") {
    return 35;
  }

  if (source.category === "정색") {
    return 5;
  }

  return 50;
}

function scheduledFeedSources(feeds: FeedSource[], now: Date, timeZone: string): FeedSource[] {
  const hour = zonedHour(now, timeZone);

  if (hour === 7 || hour === 16) {
    return [];
  }

  if (hour >= 0 && hour <= 6) {
    return feeds.filter((feed) => isUsTechFeed(feed) || isUsBusinessFeed(feed) || isGlobalMarketFeed(feed));
  }

  if (hour >= 8 && hour <= 15) {
    return feeds.filter(isKoreaMarketFeed);
  }

  if (hour >= 17 && hour <= 18) {
    return feeds.filter((feed) => isKoreaMarketFeed(feed) || isUsBusinessFeed(feed));
  }

  if (hour >= 19 && hour <= 23) {
    return feeds.filter((feed) => isUsTechFeed(feed) || isUsBusinessFeed(feed) || isGlobalMarketFeed(feed));
  }

  return feeds;
}

function feedWindowName(now: Date, timeZone: string): string {
  const hour = zonedHour(now, timeZone);
  if (hour >= 0 && hour <= 6) {
    return "us-tech-night";
  }
  if (hour === 7) {
    return "us-market-close-only";
  }
  if (hour >= 8 && hour <= 15) {
    return "korea-day";
  }
  if (hour === 16) {
    return "korea-market-close-only";
  }
  if (hour >= 17 && hour <= 18) {
    return "korea-aftermarket-plus-npr";
  }
  return "us-tech-evening";
}

function isUsTechFeed(feed: FeedSource): boolean {
  const name = feed.name.toLowerCase();
  return name.includes("the verge") || name.includes("ars technica");
}

function isUsBusinessFeed(feed: FeedSource): boolean {
  return feed.name.toLowerCase().includes("npr business");
}

function isKoreaMarketFeed(feed: FeedSource): boolean {
  return feed.name.includes("연합인포맥스") && !isGlobalMarketFeed(feed);
}

function isGlobalMarketFeed(feed: FeedSource): boolean {
  return feed.name.includes("해외주식") || feed.name.includes("국제뉴스");
}

function zonedHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false
  }).format(now);
  return Number(hour);
}

async function extractFactsWithFallback(
  config: ReturnType<typeof loadConfig>,
  source: SourceItem,
  pageText: string
): Promise<FactSummary> {
  if (source.category === "정색") {
    return seriousFacts(source, pageText);
  }

  if (!source.synthetic) {
    return fallbackFacts(source, pageText);
  }

  try {
    return await extractFacts(config, source, pageText);
  } catch (error) {
    throw error;
  }
}

async function generateAndValidate(
  config: ReturnType<typeof loadConfig>,
  source: SourceItem,
  facts: FactSummary,
  pageText: string
) {
  if (source.category === "정색") {
    return await generateSeriousAndValidate(config, source, facts, pageText);
  }

  const sourceText = [source.title, source.summary, pageText].join("\n");
  let draft: GeneratedArticleJson;
  try {
    draft = await generateSatireArticle(config, source, facts);
  } catch (error) {
    const fallback = fallbackMarketArticle(source, error);
    if (fallback) {
      return fallback;
    }
    throw error;
  }

  const draftValidation = validateGeneratedArticle(draft, source, facts, sourceText);
  if (!source.synthetic && (draftValidation.ok || isSoftSatireValidationFailure(draftValidation.reasons))) {
    if (!draftValidation.ok) {
      console.warn(
        JSON.stringify({
          event: "regular_final_draft_soft_validation_accepted",
          title: source.title,
          reasons: draftValidation.reasons
        })
      );
    }
    return draft;
  }

  let first: GeneratedArticleJson;
  try {
    first = await intensifySatireArticle(config, source, facts, draft);
  } catch (error) {
    const fallback = fallbackMarketArticle(source, error);
    if (fallback) {
      return fallback;
    }
    const draftValidation = validateGeneratedArticle(draft, source, facts, sourceText);
    if (draftValidation.ok || isSoftSatireValidationFailure(draftValidation.reasons)) {
      console.warn(
        JSON.stringify({
          event: "intensify_failed_draft_accepted",
          title: source.title,
          error: errorMessage(error),
          validation: draftValidation.reasons
        })
      );
      return draft;
    }
    throw error;
  }
  const firstValidation = validateGeneratedArticle(first, source, facts, sourceText);

  if (firstValidation.ok) {
    return first;
  }

  if (!source.synthetic && isSoftSatireValidationFailure(firstValidation.reasons)) {
    console.warn(
      JSON.stringify({
        event: "soft_satire_validation_accepted",
        title: source.title,
        reasons: firstValidation.reasons
      })
    );
    return first;
  }

  if (!source.synthetic) {
    throw new Error(`validation failed: ${firstValidation.reasons.join("; ")}`);
  }

  const retryDraft = await generateSatireArticle(
    config,
    source,
    facts,
    `The previous draft failed validation for: ${firstValidation.reasons.join("; ")}. Rewrite the JSON article to fix these issues.`
  );
  const retry = await intensifySatireArticle(
    config,
    source,
    facts,
    retryDraft,
    `The previous intensified draft failed validation for: ${firstValidation.reasons.join("; ")}. Preserve factual safety, but do not retreat into bland summary.`
  );
  const retryValidation = validateGeneratedArticle(retry, source, facts, sourceText);

  if (!retryValidation.ok) {
    const error = new Error(`validation failed after retry: ${retryValidation.reasons.join("; ")}`);
    const fallback = fallbackMarketArticle(source, error);
    if (fallback) {
      return fallback;
    }
    throw error;
  }

  return retry;
}

async function generateSeriousAndValidate(
  config: ReturnType<typeof loadConfig>,
  source: SourceItem,
  facts: FactSummary,
  pageText: string
): Promise<GeneratedArticleJson> {
  const evaluation = source.seriousEvaluation;
  if (!evaluation) {
    throw new Error("serious source is missing editorial evaluation");
  }

  const sourceText = [source.title, source.summary, pageText, evaluation.angle, evaluation.hidden_cost].join("\n");
  const draft = await generateSeriousArticle(config, source, facts, evaluation);
  const draftValidation = validateGeneratedArticle(draft, source, facts, sourceText);
  if (draftValidation.ok) {
    return draft;
  }

  const retry = await generateSeriousArticle(
    config,
    source,
    facts,
    evaluation,
    `The previous draft failed validation for: ${draftValidation.reasons.join("; ")}. Rewrite as serious 정색 criticism, not satire, and stay grounded in supplied facts.`
  );
  const retryValidation = validateGeneratedArticle(retry, source, facts, sourceText);
  if (!retryValidation.ok) {
    throw new Error(`serious validation failed after retry: ${retryValidation.reasons.join("; ")}`);
  }

  return retry;
}

function fallbackFacts(source: SourceItem, pageText: string): FactSummary {
  const summary = [source.summary, pageText].join(" ").replace(/\s+/g, " ").trim();
  const mockableDetails = groundedMockableFragments(source, pageText);
  const securityDetails = source.securityPreyEvaluation?.concrete_details ?? [];
  return {
    entities: [
      source.feedName,
      source.securityPreyEvaluation?.target ?? "",
      ...keywordFragmentsForFallback(source.title).slice(0, 4)
    ].filter(Boolean),
    numbers: summary.match(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?/g)?.slice(0, 8) ?? [],
    dates: source.publishedAt ? [source.publishedAt] : [],
    conflict_or_controversy: source.securityPreyEvaluation?.ridicule_angle || source.summary || source.title,
    money_stock_market_angle: source.category === "시장" ? source.summary : "",
    reader_relevance: source.securityPreyEvaluation?.why_it_is_mockable || source.summary || source.title,
    satire_targets: [source.securityPreyEvaluation?.target ?? "", source.title].filter(Boolean),
    mockable_details: [...securityDetails, ...mockableDetails].slice(0, 8),
    weak_points: [source.securityPreyEvaluation?.ridicule_angle ?? "", ...mockableDetails].filter(Boolean).slice(0, 5),
    corporate_euphemisms: [],
    facts: [
      source.title,
      source.summary,
      source.securityPreyEvaluation?.ridicule_angle ?? "",
      source.securityPreyEvaluation?.why_it_is_mockable ?? "",
      ...securityDetails,
      ...mockableDetails.slice(0, 5),
      summary.slice(0, 700)
    ].filter(Boolean)
  };
}

function groundedMockableFragments(source: SourceItem, pageText: string): string[] {
  const text = [source.summary, pageText].join(" ").replace(/\s+/g, " ");
  const fragments = text
    .split(/(?<=[.!?。])\s+|(?<=다\.)\s+|(?<=요\.)\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 24 && part.length <= 240)
    .filter((part) => hasConcreteSatireMaterial(part))
    .filter((part) => !looksLikeSourceCoverageMeta(part, source));

  const seen = new Set<string>();
  const output: string[] = [];
  for (const fragment of fragments) {
    const key = fragment.slice(0, 80);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(fragment);
    if (output.length >= 8) {
      break;
    }
  }

  return output.length > 0 ? output : [source.summary].filter((value) => value.length >= 20);
}

function hasConcreteSatireMaterial(value: string): boolean {
  return /[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?|\$\d+|가격|요금|구독|비용|없|빠진|실패|취소|지연|논란|소송|규제|명령|보안|유출|개인정보|해고|감원|중단|철회|ban|blocked|delay|failed|missing|without|privacy|security|lawsuit|price|fee|subscription|layoff|recall/i.test(value);
}

function looksLikeSourceCoverageMeta(value: string, source: SourceItem): boolean {
  const normalized = value.toLowerCase();
  const outlet = source.feedName.toLowerCase();
  const sourceNames = [
    outlet,
    "the verge",
    "ars technica",
    "npr",
    "연합인포맥스",
    "보도",
    "기사",
    "원문",
    "기자",
    "매체",
    "문장",
    "제목"
  ];
  const sourceMention = sourceNames.some((term) => term && normalized.includes(term));
  if (!sourceMention) {
    return false;
  }

  return /전했다|보도했다|소개했다|기사|원문|기자|매체|문장|제목|roundup|podcast|live blog|newsletter/i.test(value);
}

function seriousFacts(source: SourceItem, pageText: string): FactSummary {
  const evaluation = source.seriousEvaluation;
  const summary = [source.summary, pageText].join(" ").replace(/\s+/g, " ").trim();
  return {
    entities: [
      source.seriousInstitution ?? source.feedName,
      source.seriousAxis ?? "정색",
      ...keywordFragmentsForFallback(source.title).slice(0, 4)
    ],
    numbers: summary.match(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?/g)?.slice(0, 10) ?? [],
    dates: source.publishedAt ? [source.publishedAt] : [],
    conflict_or_controversy: evaluation?.angle ?? (source.summary || source.title),
    money_stock_market_angle: source.seriousAxis === "생활경제" || source.seriousAxis === "기업" ? source.summary : "",
    reader_relevance: evaluation?.who_pays ?? (source.summary || source.title),
    satire_targets: [evaluation?.angle ?? source.title].filter(Boolean),
    mockable_details: [source.title, source.summary, evaluation?.missing_question].filter(Boolean).slice(0, 5) as string[],
    weak_points: [evaluation?.hidden_cost, evaluation?.who_pays, evaluation?.who_benefits].filter(Boolean) as string[],
    corporate_euphemisms: keywordFragmentsForFallback(`${source.title} ${source.summary}`).slice(0, 6),
    facts: [
      source.title,
      source.summary,
      summary.slice(0, 1200),
      evaluation ? `정색 angle: ${evaluation.angle}` : "",
      evaluation ? `who benefits: ${evaluation.who_benefits}` : "",
      evaluation ? `who pays: ${evaluation.who_pays}` : "",
      evaluation ? `hidden cost: ${evaluation.hidden_cost}` : "",
      evaluation ? `missing question: ${evaluation.missing_question}` : ""
    ].filter(Boolean)
  };
}

function seriousEditorialEntry(article: PreparedArticle): SeriousEditorialEntry | null {
  const evaluation = article.seriousEvaluation;
  if (!evaluation || article.category !== "정색") {
    return null;
  }

  return {
    date: article.date.slice(0, 10),
    axis: evaluation.axis,
    institution: evaluation.institution,
    angle_type: evaluation.angle_type,
    title: article.title,
    source_url: article.source_url
  };
}

function keywordFragmentsForFallback(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}\s.$%원달러-]/gu, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function fallbackMarketArticle(source: SourceItem, error: unknown): GeneratedArticleJson | null {
  if (!source.synthetic || source.category !== "시장") {
    return null;
  }

  console.warn(
    JSON.stringify({
      event: "market_fallback_article",
      title: source.title,
      error: errorMessage(error)
    })
  );

  const rows = parseMarketRows(source.summary);
  const marketName = source.title.includes("미장") ? "미장" : "국장";
  const day = source.publishedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const lead = rows[0];
  const title = lead
    ? `${lead.name}, 오늘은 이름값 때문에 움직였다... ${marketName} 마감판이 설명을 포기했다`
    : `${marketName} 마감, 숫자는 있었고 이유는 끝내 출근하지 않았다`;

  const lines = rows.length > 0
    ? rows.map((row, index) => marketSentence(row, index))
    : [`${marketName}에는 숫자가 있었지만, 숫자를 설득할 만한 이유는 현장에 도착하지 못했다.`];

  const body = [
    `${day} ${marketName} 마감판에는 숫자가 먼저 도착했고 이유는 한참 뒤에도 오지 않았다. 그래서 The Ploradian 시장 데스크는 정상적인 설명을 포기하고, 종목명이 풍기는 기분과 숫자의 표정만으로 오늘의 움직임을 정리했다. 숫자는 실제로 남기되, 이유는 일부러 쓸모없게 붙인다. 그래야 오늘 시장이 적어도 솔직하게 이상해진다.`,
    ...lines,
    `이날 ${marketName}을 설명하는 일은 결국 숫자 옆에 말도 안 되는 사유를 붙이는 사무직 체조에 가까웠다. 오르면 오른 대로, 내리면 내린 대로, 보합이면 보합인 척하느라 지친 표정으로 앉아 있었다. 다행히 모든 등락률은 그대로 남았다. 불행히도 이유는 아무도 정상적으로 챙기지 않았다.`,
    `결론적으로 오늘의 ${marketName}은 대단한 해석을 요구하지 않았다. 숫자는 숫자였고, 이름은 이름이었고, 데스크는 그 둘 사이에 억지로 의자를 놓았다. 누군가 왜 움직였느냐고 묻는다면 답은 간단하다. 종목들이 각자 자기 이름을 너무 오래 바라보다가 그만 방향을 정해버린 것이다.`
  ].join("\n\n");

  return {
    title,
    subtitle: "등락률은 그대로 두고 이유만 전부 이상하게 붙인 마감 정리",
    category: "시장",
    slug: `${day}-${marketName === "국장" ? "korea" : "us"}-market-close-nonsense`,
    satire_brief: {
      target: "시장 마감 해석",
      ridiculous_core: "숫자는 실제지만 이유는 종목명과 생활감으로 억지 해석한다.",
      straight_faced_defense: [
        "숫자는 이미 충분히 진지하므로 이유는 조금 쉬어도 된다.",
        "종목명은 하루 종일 차트를 보느라 자기 역할을 다했다.",
        "마감 해석은 원래 끝난 일을 그럴듯하게 다시 접는 업무다."
      ],
      must_include_jabs: rows.slice(0, 4).map((row) => `${row.name} ${row.change}`),
      analogies: ["계단 핑계", "이름값 체조", "마감판 사무직 체조"]
    },
    body,
    source_name: source.feedName,
    source_url: source.url,
    original_title: source.title
  };
}

interface MarketRow {
  name: string;
  symbol: string;
  price: string;
  change: string;
  business: string;
  jokeSeed: string;
}

function parseMarketRows(summary: string): MarketRow[] {
  return summary
    .split("\n")
    .map((line) => {
      const match = /^-\s+(.+?)\s+\((.+?)\):\s+(.+?),\s+([+-]\d+(?:\.\d+)?%)(?:\s+\|\s+하는 일:\s+(.+?))?(?:\s+\|\s+드립 재료:\s+(.+))?$/.exec(line.trim());
      return match;
    })
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      name: match[1] ?? "",
      symbol: match[2] ?? "",
      price: match[3] ?? "",
      change: match[4] ?? "",
      business: match[5] ?? "업종 단서 없음",
      jokeSeed: match[6] ?? match[1] ?? ""
    }))
    .filter((row) => {
      return Boolean(row.name && row.symbol && row.price && row.change);
    });
}

function marketSentence(row: MarketRow, index: number): string {
  const name = `${row.name}${topicParticle(row.name)}`;
  const direction = row.change.startsWith("-") ? "내렸다" : row.change.startsWith("+") ? "올랐다" : "가만히 있었다";
  const amount = Number(row.change.replace(/[+%]/g, ""));
  const absolute = Math.abs(amount);
  const scale = absolute >= 10
    ? "이 정도면 계단이 아니라 건물 엘리베이터가 층수 버튼을 전부 누른 수준"
    : absolute >= 5
      ? "한 칸 움직였다고 우기기엔 표정이 너무 큰 수준"
      : absolute >= 1
        ? "마감판이 못 본 척하기엔 살짝 티 나는 수준"
        : "돋보기 없이는 핑계도 작아지는 수준";
  const excuses = [
    `${name} ${row.business} 회사답게 ${row.jokeSeed} 중 하나를 잘못 만진 듯 ${direction}. 가격표는 ${row.price}, 등락률은 ${row.change}였다. ${scale}이다.`,
    `${name} 오늘 ${direction}. ${row.jokeSeed}가 회의실에서 혼자 너무 진지해진 탓으로 보인다. 숫자는 ${row.change}, 종목코드 ${row.symbol}은 옆에서 아무것도 모른다는 표정을 유지했다.`,
    `${row.name}의 ${row.change}는 ${row.business}가 아니라 ${row.jokeSeed}의 컨디션 문제로 해석된다. 마감판은 이 설명을 믿지 않았지만, 대체 설명도 딱히 준비하지 못해 조용히 받아 적었다.`,
    `${name} ${row.price}라는 숫자를 앞에 세워놓고 ${direction}. ${row.business}라는 그럴듯한 명함을 달고도 결국 오늘의 원인은 ${row.jokeSeed} 근처에서 길을 잃은 것으로 처리됐다.`,
    `${row.name}은 장중 내내 ${row.jokeSeed}를 들고 자기소개를 하다가 ${direction}. 등락률 ${row.change}는 ${scale}이라, 데스크가 모른 척하기에도 약간 민망했다.`
  ];

  return excuses[index % excuses.length] ?? excuses[0] ?? `${row.name}은 ${row.change}만큼 움직였다. 이유는 끝내 사무실에 도착하지 않았다.`;
}

function topicParticle(value: string): "은" | "는" {
  const last = [...value].at(-1);
  if (!last) {
    return "는";
  }
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) {
    return "는";
  }
  return (code - 0xac00) % 28 === 0 ? "는" : "은";
}

function isSoftSatireValidationFailure(reasons: string[]): boolean {
  return reasons.length > 0 && reasons.every((reason) => {
    return (
      reason.startsWith("satire is too polite") ||
      reason.startsWith("article reads like serious criticism") ||
      reason.startsWith("article lacks deadpan corporate-defense satire") ||
      reason.startsWith("article lacks direct bite or deadpan ridicule") ||
      reason.startsWith("satire is not biting enough") ||
      reason.startsWith("too many serious critique terms") ||
      reason.startsWith("does not visibly attack any extracted weak point") ||
      reason.startsWith("does not visibly attack enough extracted weak point") ||
      reason.startsWith("too much analogy for too little source detail") ||
      reason.startsWith("satire_brief must include") ||
      reason.startsWith("body does not use enough")
    );
  });
}

async function unseenCandidates(items: SourceItem[], seen: SeenStore): Promise<SourceItem[]> {
  const output: SourceItem[] = [];
  const runSeen = new Set<string>();
  const seenTopicTokens = Object.values(seen.items).map((item) => topicTokens(item.title));

  for (const item of items) {
    const hash = await sourceHash(item);
    if (seen.items[hash] || runSeen.has(hash)) {
      continue;
    }
    if (
      !item.synthetic &&
      !isSecurityPrivacyFollowUp(item) &&
      seenTopicTokens.some((tokens) => isSameSourceTopic(topicTokens(`${item.title} ${item.summary}`), tokens))
    ) {
      continue;
    }
    runSeen.add(hash);
    output.push(item);
  }

  return output;
}

function topicTokens(value: string): Set<string> {
  const normalized = decodeHtmlEntitiesForTopic(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "own",
    "new",
    "after",
    "about",
    "says",
    "said",
    "news",
    "update",
    "상보",
    "마감",
    "속보"
  ]);
  return new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopwords.has(token))
      .slice(0, 32)
  );
}

function isSameSourceTopic(left: Set<string>, right: Set<string>): boolean {
  if (left.size < 3 || right.size < 3) {
    return false;
  }

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  return overlap >= 4 || (overlap >= 3 && overlap / Math.min(left.size, right.size) >= 0.6);
}

function isSecurityPrivacyFollowUp(source: SourceItem): boolean {
  const text = `${source.feedName} ${source.title} ${source.summary}`.toLowerCase();
  return (
    /(보안뉴스|security)/i.test(text) &&
    /(개인정보|유출|침해|breach|leak|privacy)/i.test(text) &&
    /(보상|배상|환불|피해\s*지원|지원책|보호\s*조치|추가\s*조치|후속\s*조치|재발\s*방지|사과|과징금|제재|분쟁조정|집단소송|손해배상|compensation|refund|remediation|settlement|fine)/i.test(text)
  );
}

function decodeHtmlEntitiesForTopic(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function filterPublishableArticles(
  target: ReturnType<typeof requireGitHubTarget>,
  articles: PreparedArticle[],
  seen: SeenStore,
  skipped: string[]
): Promise<PreparedArticle[]> {
  const output: PreparedArticle[] = [];
  const runHashes = new Set<string>();
  const runPaths = new Set<string>();

  for (const article of articles) {
    if (seen.items[article.sourceHash]) {
      skipped.push(`source already seen before commit: ${article.original_title}`);
      continue;
    }

    if (runHashes.has(article.sourceHash)) {
      skipped.push(`duplicate source in current commit: ${article.original_title}`);
      continue;
    }

    if (runPaths.has(article.path)) {
      skipped.push(`duplicate article path in current commit: ${article.path}`);
      continue;
    }

    if (await githubPathExists(target, article.path)) {
      skipped.push(`article path already exists before commit: ${article.path}`);
      continue;
    }

    runHashes.add(article.sourceHash);
    runPaths.add(article.path);
    output.push(article);
  }

  return output;
}

function finish(
  partial: Omit<PipelineResult, "finishedAt">
): PipelineResult {
  return {
    ...partial,
    finishedAt: new Date().toISOString()
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

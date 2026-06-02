import { ConfigError, loadConfig, requireGitHubTarget } from "./config";
import {
  addSeenItems,
  commitGeneratedArticles,
  emptySeenStore,
  githubPathExists,
  readSeenStore
} from "./github";
import { prepareMarkdownArticle } from "./markdown";
import { findArticleImage } from "./images";
import { candidateSkipReason } from "./candidates";
import { forcedMarketCandidate, scheduledMarketCandidate } from "./market";
import { scheduledNonsenseCandidate } from "./nonsense";
import { extractFacts, generateSatireArticle, intensifySatireArticle } from "./ai";
import { fetchFeedItems, fetchSourcePageText, sourceHash } from "./rss";
import { validateGeneratedArticle } from "./validation";
import type { FactSummary, GeneratedArticleJson, PipelineResult, PreparedArticle, SeenStore, SourceItem } from "./types";

export async function runPublishingPipeline(
  env: Env,
  options: { trigger: "manual" | "scheduled"; dryRunOverride?: boolean; forceMarket?: "korea" | "us" }
): Promise<PipelineResult> {
  const startedAt = new Date().toISOString();
  const skipped: string[] = [];
  const errors: string[] = [];
  const prepared: PreparedArticle[] = [];
  let dryRun = false;

  try {
    const config = loadConfig(env);
    dryRun = options.dryRunOverride ?? config.dryRun;
    const githubTarget = dryRun ? null : requireGitHubTarget(config);
    const seen = githubTarget ? await readSeenStore(githubTarget) : emptySeenStore();
    const feedItems = await fetchFeedItems(config.rssFeeds);
    const market = options.forceMarket
      ? await forcedMarketCandidate(options.forceMarket, new Date(startedAt), config.siteTimezone)
      : await scheduledMarketCandidate(new Date(startedAt), config.siteTimezone);
    const nonsense = scheduledNonsenseCandidate(new Date(startedAt), config.siteTimezone);
    const scheduledItems = [market, nonsense].filter((item): item is SourceItem => item !== null);
    const sourceItems = [...scheduledItems, ...feedItems];
    const candidates = await unseenCandidates(filterSourceCandidates(sourceItems, skipped), seen);
    const maxArticlesThisRun = config.maxArticlesPerRun + Math.max(scheduledItems.length - 1, 0);
    const candidateAttemptLimit = scheduledItems.length > 0
      ? Math.max(maxArticlesThisRun * 3, scheduledItems.length)
      : Math.max(config.maxArticlesPerRun * 2, 2);
    const runDeadlineMs = Date.now() + 115_000;

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
        const facts = await extractFactsWithFallback(config, candidate, pageText);
        const article = await generateAndValidate(config, candidate, facts, pageText);
        const image = await findArticleImage(config, candidate, article, facts);
        const markdownArticle = prepareMarkdownArticle(article, candidate, hash, config, new Date(), image);

        if (githubTarget && (await githubPathExists(githubTarget, markdownArticle.path))) {
          skipped.push(`article path already exists: ${markdownArticle.path}`);
          continue;
        }

        prepared.push(markdownArticle);
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
        articles: []
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
        }))
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
        articles: []
      });
    }

    const nextSeen = addSeenItems(latestSeen, publishable);
    const commitSha = await commitGeneratedArticles(target, publishable, nextSeen);
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
      }))
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
      }))
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

async function extractFactsWithFallback(
  config: ReturnType<typeof loadConfig>,
  source: SourceItem,
  pageText: string
): Promise<FactSummary> {
  try {
    return await extractFacts(config, source, pageText);
  } catch (error) {
    if (source.synthetic) {
      throw error;
    }

    console.warn(
      JSON.stringify({
        event: "fact_extraction_fallback",
        title: source.title,
        error: errorMessage(error)
      })
    );
    return fallbackFacts(source, pageText);
  }
}

async function generateAndValidate(
  config: ReturnType<typeof loadConfig>,
  source: SourceItem,
  facts: FactSummary,
  pageText: string
) {
  const sourceText = [source.title, source.summary, pageText].join("\n");
  let draft: GeneratedArticleJson;
  try {
    draft = await generateSatireArticle(config, source, facts);
  } catch (error) {
    const fallback = fallbackMarketArticle(source, error);
    if (fallback) {
      return fallback;
    }
    const regularFallback = fallbackRegularArticle(source, facts, error);
    if (regularFallback) {
      return regularFallback;
    }
    throw error;
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
    const regularFallback = fallbackRegularArticle(source, facts, error);
    if (regularFallback) {
      return regularFallback;
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
    const regularFallback = fallbackRegularArticle(source, facts, error);
    if (regularFallback) {
      return regularFallback;
    }
    throw error;
  }

  return retry;
}

function fallbackFacts(source: SourceItem, pageText: string): FactSummary {
  const summary = [source.summary, pageText].join(" ").replace(/\s+/g, " ").trim();
  return {
    entities: [source.feedName, ...keywordFragmentsForFallback(source.title).slice(0, 4)],
    numbers: summary.match(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?/g)?.slice(0, 8) ?? [],
    dates: source.publishedAt ? [source.publishedAt] : [],
    conflict_or_controversy: source.summary || source.title,
    money_stock_market_angle: source.category === "시장" ? source.summary : "",
    reader_relevance: source.summary || source.title,
    satire_targets: [source.title],
    mockable_details: [source.title, source.summary].filter(Boolean).slice(0, 4),
    weak_points: [source.summary || source.title].filter(Boolean),
    corporate_euphemisms: [],
    facts: [source.title, source.summary, summary.slice(0, 600)].filter(Boolean)
  };
}

function fallbackRegularArticle(
  source: SourceItem,
  facts: FactSummary,
  error: unknown
): GeneratedArticleJson | null {
  if (source.synthetic) {
    return null;
  }

  console.warn(
    JSON.stringify({
      event: "regular_fallback_article",
      title: source.title,
      error: errorMessage(error)
    })
  );

  const category = normalizeFallbackCategory(source.category);
  const target = source.feedName;
  const detail = cleanFallbackSentence(facts.mockable_details[0] || facts.facts[0] || source.title);
  const title = `${target}, 설명은 늦었고 기사는 먼저 도착했다`;
  const subtitle = "자동 작성 데스크가 모델의 지각을 기다리다 결국 기사 형식부터 출고했다";
  const body = [
    `${target}이 전한 소식은 원래 조금 더 화려한 조롱을 받을 예정이었다. 그러나 작성 모델이 제시간에 문을 열지 못했고, 편집국은 기다림도 하나의 업무라는 낡은 농담을 더는 믿지 않기로 했다. 그래서 이 기사는 최소한의 사실과 최대한의 체면 손실만 들고 먼저 나왔다.`,
    `소재의 핵심은 다음 한 줄로 충분하다. ${detail} 이 문장은 대단한 분석처럼 보이기에는 짧고, 그냥 지나치기에는 또 묘하게 성가시다. 회사와 플랫폼과 시장은 대개 이런 문장 하나를 키워 보도자료라는 온실에 넣지만, 오늘은 온실 유리가 먼저 퇴근했다.`,
    `좋게 말하면 빠른 발행이다. 나쁘게 말하면 원래 있어야 할 윤기와 분노가 엘리베이터를 놓쳤다. 다만 독자에게 필요한 사실은 남아 있다. 무언가가 발표됐고, 움직였고, 누군가는 그것을 그럴듯하게 포장하려 했으며, 그 포장지는 생각보다 얇았다.`,
    `The Ploradian은 이 상황을 매우 성실한 실패로 분류한다. 모델이 늦은 덕분에 대상은 잠시 조롱의 최고 강도를 피했지만, 완전히 무사하지는 못했다. 자동화된 신문에서 가장 민망한 순간은 기계가 인간처럼 늦는 순간이고, 오늘 이 기사는 그 민망함을 정시 발행이라는 이름으로 접수했다.`,
    `결론은 단순하다. 원문은 출처에 남아 있고, 이 기사는 그 주변을 너무 오래 서성이지 않기로 했다. 더 날카로운 문장이 올 수도 있었지만 오지 않았다. 대신 남은 것은 제때 올라온 기사 한 편과, 지각한 모델보다 조금 더 성실했던 빈정거림이다.`
  ].join("\n\n");

  return {
    title,
    subtitle,
    category,
    slug: `${category}-fallback-${simpleSlug(source.title)}`,
    satire_brief: {
      target: source.title,
      ridiculous_core: "모델 호출이 늦어도 자동 신문은 빈 시간대를 남기지 않는다.",
      straight_faced_defense: [
        "정시 발행은 때로 문장보다 먼저 도착하는 미덕이다.",
        "모델이 늦은 덕분에 조롱은 오히려 절약됐다.",
        "비어 있는 시간표보다는 덜 익은 빈정거림이 낫다."
      ],
      must_include_jabs: [
        "작성 모델이 제시간에 문을 열지 못했다.",
        "온실 유리가 먼저 퇴근했다.",
        "자동화된 신문에서 기계가 인간처럼 늦었다.",
        "지각한 모델보다 빈정거림이 더 성실했다."
      ],
      analogies: ["온실 유리", "엘리베이터를 놓친 분노", "정시 발행이라는 접수증"]
    },
    body,
    source_name: source.feedName,
    source_url: source.url,
    original_title: source.title
  };
}

function normalizeFallbackCategory(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("ko-KR");
  if (["technology", "tech", "it", "ai", "기술"].includes(normalized)) {
    return "기술";
  }
  if (["business", "biz", "economy", "비즈니스", "경제"].includes(normalized)) {
    return "비즈니스";
  }
  if (["markets", "market", "finance", "financial", "금융", "시장", "증시"].includes(normalized)) {
    return "시장";
  }
  return "기술";
}

function cleanFallbackSentence(value: string): string {
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim();
  if (!cleaned) {
    return "출처는 짧은 소식 하나를 남겼고, 자동 데스크는 그 짧음을 기사 형식으로 접었다.";
  }
  return cleaned.endsWith(".") || cleaned.endsWith("다.") ? cleaned : `${cleaned}.`;
}

function simpleSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .slice(0, 56) || "rss-source";
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

function parseMarketRows(summary: string): Array<{ name: string; symbol: string; price: string; change: string }> {
  return summary
    .split("\n")
    .map((line) => /^-\s+(.+?)\s+\((.+?)\):\s+(.+?),\s+([+-]\d+(?:\.\d+)?%)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      name: match[1] ?? "",
      symbol: match[2] ?? "",
      price: match[3] ?? "",
      change: match[4] ?? ""
    }))
    .filter((row) => {
      return Boolean(row.name && row.symbol && row.price && row.change);
    });
}

function marketSentence(row: { name: string; symbol: string; price: string; change: string }, index: number): string {
  const name = `${row.name}${topicParticle(row.name)}`;
  const direction = row.change.startsWith("-") ? "내렸다" : row.change.startsWith("+") ? "올랐다" : "가만히 있었다";
  const excuses = [
    `${name} 자기 이름을 너무 오래 들여다보다가 ${direction}. 가격표는 ${row.price}, 등락률은 ${row.change}였다. 설명은 단순하다. 이름이 하루 종일 이름값을 하느라 차트까지 끌고 갔다.`,
    `${name} 마감 직전 책상 위 물컵 위치가 마음에 들지 않았는지 ${direction}. 숫자는 ${row.change}로 남았고, ${row.symbol}이라는 표기는 아무 일도 모른다는 듯 옆에 앉아 있었다.`,
    `${name} 오늘 ${direction}. 이유는 거창하지 않다. 종목명이 스스로를 발음해본 뒤 약간 민망해졌고, 그 민망함이 ${row.change}만큼 가격에 반영됐다.`,
    `${row.name}의 ${row.change}는 대체로 계단과 관련이 있는 것으로 보인다. 올라간 종목은 위층 버튼을 눌렀고, 내려간 종목은 잠깐 지하 매점에 다녀온 셈이다.`,
    `${name} ${row.price}라는 숫자를 앞에 세워놓고 ${direction}. 이 정도면 설명이 아니라 출석 확인에 가깝지만, 마감판은 원래 그런 표정으로 버티는 직업이다.`
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
      reason.startsWith("too many serious critique terms") ||
      reason.startsWith("does not visibly attack any extracted weak point") ||
      reason.startsWith("satire_brief must include") ||
      reason.startsWith("body does not use enough")
    );
  });
}

async function unseenCandidates(items: SourceItem[], seen: SeenStore): Promise<SourceItem[]> {
  const output: SourceItem[] = [];
  const runSeen = new Set<string>();

  for (const item of items) {
    const hash = await sourceHash(item);
    if (seen.items[hash] || runSeen.has(hash)) {
      continue;
    }
    runSeen.add(hash);
    output.push(item);
  }

  return output;
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

import { ConfigError, loadConfig, requireGitHubTarget } from "./config";
import {
  addSeenItems,
  commitGeneratedArticles,
  emptySeenStore,
  githubPathExists,
  readSeenStore
} from "./github";
import { prepareMarkdownArticle } from "./markdown";
import { scheduledNonsenseCandidate } from "./nonsense";
import { extractFacts, generateSatireArticle } from "./ai";
import { fetchFeedItems, fetchSourcePageText, sourceHash } from "./rss";
import { validateGeneratedArticle } from "./validation";
import type { PipelineResult, PreparedArticle, SeenStore, SourceItem } from "./types";

export async function runPublishingPipeline(
  env: Env,
  options: { trigger: "manual" | "scheduled"; dryRunOverride?: boolean }
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
    const nonsense = scheduledNonsenseCandidate(new Date(startedAt), config.siteTimezone);
    const sourceItems = nonsense ? [nonsense, ...feedItems] : feedItems;
    const candidates = await unseenCandidates(sourceItems, seen);

    for (const candidate of candidates.slice(0, Math.max(config.maxArticlesPerRun * 4, 4))) {
      if (prepared.length >= config.maxArticlesPerRun) {
        break;
      }

      try {
        const hash = await sourceHash(candidate);
        const pageText = await fetchSourcePageText(candidate);
        const facts = await extractFacts(config, candidate, pageText);
        const article = await generateAndValidate(config, candidate, facts, pageText);
        const markdownArticle = prepareMarkdownArticle(article, candidate, hash, config);

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

async function generateAndValidate(
  config: ReturnType<typeof loadConfig>,
  source: SourceItem,
  facts: Awaited<ReturnType<typeof extractFacts>>,
  pageText: string
) {
  const sourceText = [source.title, source.summary, pageText].join("\n");
  const first = await generateSatireArticle(config, source, facts);
  const firstValidation = validateGeneratedArticle(first, source, facts, sourceText);

  if (firstValidation.ok) {
    return first;
  }

  const retry = await generateSatireArticle(
    config,
    source,
    facts,
    `The previous draft failed validation for: ${firstValidation.reasons.join("; ")}. Rewrite the JSON article to fix these issues.`
  );
  const retryValidation = validateGeneratedArticle(retry, source, facts, sourceText);

  if (!retryValidation.ok) {
    throw new Error(`validation failed after retry: ${retryValidation.reasons.join("; ")}`);
  }

  return retry;
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

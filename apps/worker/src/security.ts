import { evaluateSecurityPreyCandidate } from "./ai";
import { fetchFeedItems, fetchSourcePageText, sourceHash } from "./rss";
import type { RuntimeConfig, SecurityPreyEvaluation, SeenStore, SourceItem } from "./types";

const BOANNEWS_FEED = {
  name: "보안뉴스 사건사고",
  url: "http://www.boannews.com/media/news_rss.xml?kind=1",
  category: "기술"
} as const;

const SECURITY_PREY_MIN_SCORE = 85;
const SECURITY_PREY_HOURS_KST = new Set([12, 17]);
const MAX_SECURITY_CANDIDATES = 8;
const MAX_SECURITY_SCORING = 5;

export interface SecurityPreySelection {
  source: SourceItem | null;
  selected: SecurityPreyEvaluation | null;
  topCandidates: SecurityPreyEvaluation[];
  reason: string;
}

export async function scheduledSecurityPreySelection(
  config: RuntimeConfig,
  seen: SeenStore,
  now: Date,
  force = false
): Promise<SecurityPreySelection> {
  if (!force && !SECURITY_PREY_HOURS_KST.has(zonedHour(now, config.siteTimezone))) {
    return emptySelection("not security prey slot");
  }

  const items = await fetchFeedItems([BOANNEWS_FEED], {
    timeoutMs: 12000,
    maxBytes: 196608,
    retries: 1
  });
  const candidates = await unseenSecurityCandidates(items, seen, now);

  if (candidates.length === 0) {
    return emptySelection("no fresh unseen Boannews security prey candidates");
  }

  const evaluated: Array<{ source: SourceItem; evaluation: SecurityPreyEvaluation }> = [];
  const scoringCandidates = candidates.slice(0, MAX_SECURITY_SCORING);
  const results = await Promise.allSettled(
    scoringCandidates.map(async (source) => {
      const pageText = await fetchSourcePageText(source);
      const evaluation = await evaluateSecurityPreyCandidate(config, source, pageText);
      return {
        source: {
          ...source,
          securityPreyEvaluation: evaluation
        },
        evaluation
      };
    })
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      evaluated.push(result.value);
      return;
    }

    console.warn(
      JSON.stringify({
        event: "security_prey_scoring_failed",
        title: scoringCandidates[index]?.title ?? "unknown",
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      })
    );
  });

  evaluated.sort((left, right) => right.evaluation.final_score - left.evaluation.final_score);
  const publishable = evaluated.find(
    (item) => item.evaluation.publish_decision === "publish" && item.evaluation.final_score >= SECURITY_PREY_MIN_SCORE
  );

  if (!publishable) {
    return {
      source: null,
      selected: null,
      topCandidates: evaluated.map((item) => item.evaluation).slice(0, 5),
      reason: `no Boannews prey reached score ${SECURITY_PREY_MIN_SCORE}`
    };
  }

  return {
    source: publishable.source,
    selected: publishable.evaluation,
    topCandidates: evaluated.map((item) => item.evaluation).slice(0, 5),
    reason: "selected Boannews security prey"
  };
}

async function unseenSecurityCandidates(items: SourceItem[], seen: SeenStore, now: Date): Promise<SourceItem[]> {
  const output: SourceItem[] = [];
  for (const item of items) {
    if (!isFresh(item, now) || securityCandidateSkipReason(item)) {
      continue;
    }

    const hash = await sourceHash(item);
    if (seen.items[hash]) {
      continue;
    }

    output.push(item);
    if (output.length >= MAX_SECURITY_CANDIDATES) {
      break;
    }
  }

  return output;
}

function securityCandidateSkipReason(source: SourceItem): string | null {
  const text = `${source.title} ${source.summary}`.toLowerCase();
  if (/(부고|빙부상|빙모상|모친상|부친상|인사|동정|채용|모집|공고|행사|컨퍼런스|세미나|미리보기|전시|박람회)/.test(text)) {
    return "routine notice";
  }

  if (/(보안\s*습관|속담으로|카드뉴스)/.test(text) && !strongPreyTerms(text)) {
    return "awareness item";
  }

  if (!strongPreyTerms(text)) {
    return "not enough security prey signal";
  }

  return null;
}

function strongPreyTerms(value: string): boolean {
  return /(cve-|취약점|인증\s*우회|제로데이|2fa|내부망|유출|개인정보|침해|해킹|랜섬웨어|백도어|공급망|다크웹|도박사이트|불법|징역|행정\s*마비|의료\s*셧다운|전력\s*중단|공공망|망분리|피해|벌금|기밀|결함|패치|vpn|malware|ransomware|breach|backdoor|supply chain)/i.test(value);
}

function isFresh(source: SourceItem, now: Date): boolean {
  if (!source.publishedAt) {
    return true;
  }

  const publishedAt = new Date(source.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) {
    return true;
  }

  return now.getTime() - publishedAt <= 4 * 24 * 60 * 60 * 1000;
}

function zonedHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false
  }).format(now);
  return Number(hour);
}

function emptySelection(reason: string): SecurityPreySelection {
  return {
    source: null,
    selected: null,
    topCandidates: [],
    reason
  };
}

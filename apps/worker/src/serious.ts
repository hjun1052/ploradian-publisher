import { evaluateSeriousCandidate } from "./ai";
import { sourceHash, fetchFeedItems, fetchSourcePageText } from "./rss";
import type {
  RuntimeConfig,
  SeenStore,
  SeriousCandidateEvaluation,
  SeriousEditorialStore,
  SeriousSource,
  SourceItem
} from "./types";

const MAX_SERIOUS_CANDIDATES_TO_SCORE = 3;
const MAX_CANDIDATES_PER_INSTITUTION = 2;
const MAX_CANDIDATES_PER_AXIS = 3;
const MAX_SERIOUS_SOURCE_AGE_DAYS = 21;
const RECENT_AXIS_DAYS = 3;
const RECENT_INSTITUTION_DAYS = 7;
const RECENT_ANGLE_COUNT = 5;
const HIGH_VALUE_TERMS = [
  "임금체불",
  "산재",
  "사망",
  "중대재해",
  "하청",
  "파견",
  "특수고용",
  "플랫폼",
  "해고",
  "구조조정",
  "최저임금",
  "수수료",
  "대출",
  "가계부채",
  "연체",
  "금리",
  "물가",
  "주거비",
  "전세",
  "월세",
  "보험",
  "자영업",
  "소상공인",
  "취약계층",
  "양극화",
  "불평등",
  "과징금",
  "제재",
  "시정명령",
  "불공정",
  "담합",
  "약관",
  "개인정보",
  "소비자 피해",
  "분쟁",
  "부담",
  "비용",
  "요금"
];
const LOW_VALUE_TERMS = [
  "주간보도계획",
  "행사",
  "회의 개최",
  "간담회",
  "포럼",
  "세미나",
  "업무협약",
  "캠페인",
  "홍보",
  "공모전",
  "수상",
  "채용",
  "공지"
];

export interface SeriousSelectionResult {
  source: SourceItem | null;
  selected: SeriousCandidateEvaluation | null;
  topCandidates: SeriousCandidateEvaluation[];
  reason: string;
}

export async function scheduledSeriousSelection(
  config: RuntimeConfig,
  seen: SeenStore,
  history: SeriousEditorialStore,
  now: Date,
  force: boolean
): Promise<SeriousSelectionResult> {
  if (!force && !isSeriousSlot(now, config.siteTimezone)) {
    return {
      source: null,
      selected: null,
      topCandidates: [],
      reason: "not serious desk slot"
    };
  }

  if (config.seriousSources.length === 0) {
    return {
      source: null,
      selected: null,
      topCandidates: [],
      reason: "SERIOUS_SOURCES_JSON is empty"
    };
  }

  const candidates = await fetchSeriousCandidates(config.seriousSources, seen);
  if (candidates.length === 0) {
    return {
      source: null,
      selected: null,
      topCandidates: [],
      reason: "no unseen serious candidates"
    };
  }

  const scoringCandidates = candidatesForScoring(candidates);
  const scored = (
    await Promise.allSettled(
      scoringCandidates.map(async (source) => {
        const pageText = await fetchSourcePageText(source);
        const rawEvaluation = await evaluateSeriousCandidate(config, source, seriousSourceExcerpt(source, pageText), history);
        const evaluation = applyDiversityAdjustment(rawEvaluation, source, history, now, config.seriousMinScore);
        return {
          source: {
            ...source,
            seriousEvaluation: evaluation
          },
          evaluation
        };
      })
    )
  ).flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return [result.value];
    }

    const source = scoringCandidates[index];
    console.warn(
      JSON.stringify({
        event: "serious_candidate_scoring_failed",
        title: source?.title ?? "unknown",
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      })
    );
    return [];
  });

  scored.sort((left, right) => right.evaluation.final_score - left.evaluation.final_score);
  const topCandidates = scored.map((item) => item.evaluation).slice(0, 5);
  const selected = scored.find(
    (item) => item.evaluation.final_score >= config.seriousMinScore && item.evaluation.publish_decision === "publish"
  );

  if (!selected) {
    return {
      source: null,
      selected: null,
      topCandidates,
      reason: `no serious candidate reached score ${config.seriousMinScore}`
    };
  }

  return {
    source: selected.source,
    selected: selected.evaluation,
    topCandidates,
    reason: "selected serious candidate"
  };
}

function candidatesForScoring(candidates: SourceItem[]): SourceItem[] {
  const selected: SourceItem[] = [];
  const institutionCounts = new Map<string, number>();
  const axisCounts = new Map<string, number>();

  for (const candidate of [...candidates].sort((left, right) => preScore(right) - preScore(left))) {
    const institution = candidate.seriousInstitution ?? candidate.feedName;
    const axis = candidate.seriousAxis ?? "정책";
    const institutionCount = institutionCounts.get(institution) ?? 0;
    const axisCount = axisCounts.get(axis) ?? 0;
    if (institutionCount >= MAX_CANDIDATES_PER_INSTITUTION || axisCount >= MAX_CANDIDATES_PER_AXIS) {
      continue;
    }

    selected.push(candidate);
    institutionCounts.set(institution, institutionCount + 1);
    axisCounts.set(axis, axisCount + 1);
    if (selected.length >= MAX_SERIOUS_CANDIDATES_TO_SCORE) {
      break;
    }
  }

  return selected;
}

function preScore(candidate: SourceItem): number {
  const text = `${candidate.feedName} ${candidate.title} ${candidate.summary}`;
  const publishedAt = candidate.publishedAt ? new Date(candidate.publishedAt).getTime() : 0;
  const recencyTieBreaker = Number.isFinite(publishedAt) ? publishedAt / 1_000_000_000_000 : 0;
  const highValueScore = HIGH_VALUE_TERMS.reduce((score, term) => score + (text.includes(term) ? 8 : 0), 0);
  const lowValuePenalty = LOW_VALUE_TERMS.reduce((score, term) => score + (text.includes(term) ? 10 : 0), 0);
  const axisBonus = candidate.seriousAxis === "노동" || candidate.seriousAxis === "규제/감시" ? 6 : 0;

  return highValueScore + axisBonus + recencyTieBreaker - lowValuePenalty;
}

async function fetchSeriousCandidates(sources: SeriousSource[], seen: SeenStore): Promise<SourceItem[]> {
  const feeds = sources
    .filter((source) => source.kind === "rss")
    .map((source) => ({
      name: source.name,
      url: source.url,
      category: "정색"
    }));
  const sourceMeta = new Map(sources.map((source) => [source.url, source]));
  const items = await fetchFeedItems(feeds, {
    timeoutMs: 5000,
    maxBytes: 1048576,
    retries: 0
  });
  const fresh: SourceItem[] = [];

  for (const item of items) {
    const meta = sourceMeta.get(item.feedUrl);
    const enriched: SourceItem = {
      ...item,
      category: "정색",
      seriousAxis: meta?.axis ?? inferAxis(item),
      seriousKind: meta?.kind ?? "rss",
      seriousInstitution: meta?.institution ?? meta?.name ?? item.feedName
    };

    if (candidateSkipReason(enriched)) {
      continue;
    }

    if (isTooOld(enriched, MAX_SERIOUS_SOURCE_AGE_DAYS)) {
      continue;
    }

    const hash = await sourceHash(enriched);
    if (seen.items[hash]) {
      continue;
    }

    fresh.push(enriched);
  }

  return fresh.sort((left, right) => {
    const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
    const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
    return rightTime - leftTime;
  });
}

export function seriousSourceExcerpt(source: SourceItem, pageText: string): string {
  return focusedExcerpt(
    cleanSourceText([source.title, source.summary, pageText].filter((value) => usefulText(value)).join(" ")),
    keywordFragments(`${source.title} ${source.summary}`)
  );
}

function isTooOld(source: SourceItem, maxAgeDays: number): boolean {
  if (!source.publishedAt) {
    return false;
  }

  const publishedAt = new Date(source.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) {
    return false;
  }

  return Date.now() - publishedAt > maxAgeDays * 86400000;
}

function applyDiversityAdjustment(
  raw: SeriousCandidateEvaluation,
  source: SourceItem,
  history: SeriousEditorialStore,
  now: Date,
  minScore: number
): SeriousCandidateEvaluation {
  const axis = source.seriousAxis ?? raw.axis;
  const institution = source.seriousInstitution ?? raw.institution;
  const today = dateKey(now, "Asia/Seoul");
  let adjustment = 0;

  if (!recentAxis(history, axis, today, RECENT_AXIS_DAYS)) {
    adjustment += 4;
  } else {
    adjustment -= 8;
  }

  if (recentInstitution(history, institution, today, RECENT_INSTITUTION_DAYS)) {
    adjustment -= 6;
  }

  if (recentAngle(history, raw.angle_type, RECENT_ANGLE_COUNT)) {
    adjustment -= 7;
  }

  const finalScore = clamp(Math.round(raw.raw_score + adjustment), 0, 100);
  return {
    ...raw,
    axis,
    institution,
    final_score: finalScore,
    publish_decision: finalScore >= minScore && raw.publish_decision !== "reject" ? "publish" : raw.publish_decision
  };
}

function candidateSkipReason(source: SourceItem): string | null {
  const text = `${source.title} ${source.summary}`.toLowerCase();
  if (/인사|부고|동정|축사|포토|사진|카드뉴스|모집|채용공고|설명회|세미나|웨비나/.test(text)) {
    return "thin announcement";
  }

  if (/업무협약|mou|협약식|캠페인|공모전|수상|선정됐다/.test(text)) {
    return "routine promotion";
  }

  return null;
}

function focusedExcerpt(text: string, keywords: string[]): string {
  if (!text) {
    return "";
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  const firstHit = keywords
    .map((keyword) => normalized.indexOf(keyword))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (firstHit === undefined) {
    return normalized.slice(0, 1200);
  }

  const start = Math.max(0, firstHit - 300);
  return normalized.slice(start, start + 1200).trim();
}

function cleanSourceText(value: string): string {
  return value
    .replace(/본문내용 바로가기[\s\S]*?(?=□|202\d년|[0-9]{4}년|붙임|자료|문의|$)/g, " ")
    .replace(/한국은행이 하는 일[\s\S]*?(?=□|202\d년|[0-9]{4}년|붙임|자료|문의|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordFragments(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}\s.%/-]/gu, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
    .slice(0, 8);
}

function usefulText(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && normalized !== "undefined" && normalized !== "null");
}

function inferAxis(source: SourceItem): SeriousCandidateEvaluation["axis"] {
  const text = `${source.feedName} ${source.title} ${source.summary}`;
  if (/노동|고용|임금|산재|하청|근로|해고|플랫폼 노동/.test(text)) {
    return "노동";
  }
  if (/물가|대출|보험|통신|주거|소비자|자영업|소상공인|가계/.test(text)) {
    return "생활경제";
  }
  if (/공정위|개인정보|금감원|금융위|제재|과징금|시정명령|감독/.test(text)) {
    return "규제/감시";
  }
  if (/정부|대책|정책|지원|개편|제도|세제|복지/.test(text)) {
    return "정책";
  }
  return "기업";
}

function isSeriousSlot(now: Date, timeZone: string): boolean {
  const slot = zonedParts(now, timeZone);
  return slot.weekday >= 1 && slot.weekday <= 5 && slot.hour === 21 && slot.minute >= 25 && slot.minute <= 40;
}

function recentAxis(history: SeriousEditorialStore, axis: string, today: string, days: number): boolean {
  return history.recent.some((entry) => entry.axis === axis && daysBetween(entry.date, today) < days);
}

function recentInstitution(history: SeriousEditorialStore, institution: string, today: string, days: number): boolean {
  return history.recent.some((entry) => entry.institution === institution && daysBetween(entry.date, today) < days);
}

function recentAngle(history: SeriousEditorialStore, angleType: string, count: number): boolean {
  return history.recent.slice(0, count).some((entry) => entry.angle_type === angleType);
}

function daysBetween(left: string, right: string): number {
  const leftTime = Date.parse(`${left}T00:00:00+09:00`);
  const rightTime = Date.parse(`${right}T00:00:00+09:00`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return 999;
  }
  return Math.abs(Math.round((rightTime - leftTime) / 86400000));
}

function dateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function zonedParts(date: Date, timeZone: string): { hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7
  };

  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: weekdayMap[get("weekday")] ?? 0
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

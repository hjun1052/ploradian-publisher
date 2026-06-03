import { evaluateAstronomyCandidate } from "./ai";
import { fetchFeedItems, fetchSourcePageText } from "./rss";
import type { AstronomyCandidateEvaluation, RuntimeConfig, SeenStore, SourceItem } from "./types";

const ASTRONOMY_DAYS = new Set(["Sun", "Wed", "Fri"]);
const SLOT_HOUR = 23;
const SLOT_MINUTE = 30;
const EVALUATION_LIMIT = 8;

const POSITIVE_TERMS = [
  "astronomy",
  "astrophysics",
  "star",
  "stars",
  "stellar",
  "galaxy",
  "galaxies",
  "black hole",
  "neutron star",
  "supernova",
  "nova",
  "nebula",
  "quasar",
  "blazar",
  "comet",
  "asteroid",
  "meteor",
  "eclipse",
  "moon",
  "lunar",
  "planet",
  "exoplanet",
  "saturn",
  "jupiter",
  "mars",
  "venus",
  "milky way",
  "cosmic",
  "universe",
  "webb",
  "jwst",
  "hubble",
  "telescope",
  "aurora",
  "solar flare",
  "magnetic",
  "interstellar",
  "light-year",
  "dark matter",
  "dark energy",
  "성운",
  "은하",
  "별",
  "항성",
  "블랙홀",
  "초신성",
  "혜성",
  "행성",
  "외계행성",
  "달",
  "월식",
  "일식",
  "우주"
];

const NEGATIVE_TERMS = [
  "stargate",
  "masters of the universe",
  "star wars",
  "lego",
  "streaming",
  "movie",
  "show",
  "trailer",
  "amazon mgm",
  "game",
  "sale",
  "deal",
  "launch company",
  "rocket launch",
  "crew",
  "astronaut",
  "spacesuit",
  "space station",
  "iss",
  "procurement",
  "challenge",
  "award",
  "webinar",
  "seminar",
  "job",
  "internship",
  "contract",
  "policy",
  "budget"
];

const NIGHT_AXES: Record<string, string> = {
  Wed: "바쁜 일상의 중간: 아직 절반이 남았다는 피로, 느린 빛과 오래 버티는 천체가 어울린다.",
  Fri: "바쁜 일상의 마지막: 끝난 것, 폭발한 것, 부서진 것, 그래도 남는 빛이 어울린다.",
  Sun: "복귀 전날의 공허함: 다른 세계, 먼 바다, 돌아오지 않는 신호, 가능성과 고요가 어울린다."
};

export async function scheduledAstronomySelection(
  config: RuntimeConfig,
  seen: SeenStore,
  now: Date,
  force = false
): Promise<{
  source: SourceItem | null;
  selected: AstronomyCandidateEvaluation | null;
  topCandidates: AstronomyCandidateEvaluation[];
  reason: string;
}> {
  const slot = astronomySlot(now, config.siteTimezone);
  if (!force && !slot.active) {
    return {
      source: null,
      selected: null,
      topCandidates: [],
      reason: "not astronomy slot"
    };
  }

  if (config.astronomyFeeds.length === 0) {
    return {
      source: null,
      selected: null,
      topCandidates: [],
      reason: "no astronomy feeds configured"
    };
  }

  const items = await fetchFeedItems(config.astronomyFeeds);
  const candidates = items
    .filter((item) => !isSeen(item, seen))
    .filter(isAstronomyCandidate)
    .sort((left, right) => astronomyPreScore(right) - astronomyPreScore(left))
    .slice(0, EVALUATION_LIMIT);

  if (candidates.length === 0) {
    return {
      source: null,
      selected: null,
      topCandidates: [],
      reason: "no unseen astronomy candidates"
    };
  }

  const scored: Array<{ source: SourceItem; evaluation: AstronomyCandidateEvaluation }> = [];
  for (const source of candidates) {
    try {
      const pageText = await fetchSourcePageText(source);
      const evaluation = await evaluateAstronomyCandidate(config, source, astronomySourceExcerpt(source, pageText), {
        day: slot.day,
        night_axis: slot.axis
      });
      scored.push({ source: { ...source, astronomyEvaluation: evaluation }, evaluation });
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "astronomy_candidate_scoring_failed",
          title: source.title,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  scored.sort((left, right) => right.evaluation.final_score - left.evaluation.final_score);
  const topCandidates = scored.map((item) => item.evaluation).slice(0, 5);
  const selected = scored.find(
    (item) => item.evaluation.final_score >= config.astronomyMinScore && item.evaluation.publish_decision === "publish"
  );

  if (!selected) {
    return {
      source: null,
      selected: null,
      topCandidates,
      reason: `no astronomy candidate reached score ${config.astronomyMinScore}`
    };
  }

  return {
    source: selected.source,
    selected: selected.evaluation,
    topCandidates,
    reason: "selected astronomy candidate"
  };
}

export function astronomySourceExcerpt(source: SourceItem, pageText: string): string {
  return [
    `Title: ${source.title}`,
    source.summary ? `RSS summary: ${source.summary}` : "",
    pageText ? `Page excerpt: ${pageText.slice(0, 1800)}` : ""
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2400);
}

function astronomySlot(now: Date, timeZone: string): { active: boolean; day: string; axis: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const day = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "-1");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "-1");
  const active = ASTRONOMY_DAYS.has(day) && hour === SLOT_HOUR && Math.abs(minute - SLOT_MINUTE) <= 10;
  return {
    active,
    day,
    axis: NIGHT_AXES[day] ?? "밤의 끝에서 천문학적 사실을 문학적 장면으로 읽는다."
  };
}

function isSeen(source: SourceItem, seen: SeenStore): boolean {
  return Object.values(seen.items).some(
    (item) => item.url === source.url || item.canonical_url === source.canonicalUrl
  );
}

function isAstronomyCandidate(source: SourceItem): boolean {
  if (/apod/i.test(`${source.feedName} ${source.feedUrl}`)) {
    return false;
  }

  const text = `${source.feedName} ${source.title} ${source.summary}`.toLowerCase();
  if (NEGATIVE_TERMS.some((term) => text.includes(term))) {
    return false;
  }

  return POSITIVE_TERMS.some((term) => text.includes(term));
}

function astronomyPreScore(source: SourceItem): number {
  const text = `${source.feedName} ${source.title} ${source.summary}`.toLowerCase();
  const positive = POSITIVE_TERMS.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
  const negative = NEGATIVE_TERMS.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
  const sourceBonus = source.feedName.includes("ESA") ? 8 : source.feedName.includes("Phys.org") ? 6 : source.feedName.includes("EarthSky") ? 4 : 0;
  const recentTime = source.publishedAt ? new Date(source.publishedAt).getTime() : 0;
  const recency = Number.isFinite(recentTime) ? Math.max(0, 5 - (Date.now() - recentTime) / 86_400_000 / 2) : 0;
  return positive * 6 + sourceBonus + recency - negative * 10;
}

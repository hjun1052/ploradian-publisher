import { fetchTextWithRetry } from "./http";
import type { RuntimeConfig, SeenStore, SourceItem } from "./types";

// Quality gate for regular satire slots: Jev (TypeSafe System One, via OpenRouter) scores each
// candidate, and only the best one that passes every safety/topic check is published.

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = "typesafe/jev-1.13";
const ALLOWED_TOPICS = ["corporate", "regulation", "security", "industry_policy"] as const;
const MAX_SCORED = 30;
const MAX_AGE_MS = 30 * 3600_000;
const JEV_CONCURRENCY = 6;

export interface SatireBlock {
  name: "night" | "morning" | "midday" | "evening";
  cap: number;
  hours: readonly [number, number];
}

// Hour-of-day (site timezone) -> publishing block. Hours 7/16 belong to the market desks and
// 12/17 to the security desk, so they return null here.
export function satireBlock(hour: number): SatireBlock | null {
  if (hour >= 0 && hour <= 6) return { name: "night", cap: 4, hours: [0, 6] };
  if (hour >= 8 && hour <= 11) return { name: "morning", cap: 2, hours: [8, 11] };
  if (hour >= 13 && hour <= 15) return { name: "midday", cap: 2, hours: [13, 15] };
  if (hour >= 18 && hour <= 23) return { name: "evening", cap: 3, hours: [18, 23] };
  return null;
}

export function countPublishedInBlock(
  seen: SeenStore,
  now: Date,
  timeZone: string,
  feedNames: ReadonlySet<string>,
  block: SatireBlock
): number {
  const today = dayKey(now, timeZone);
  let count = 0;
  for (const item of Object.values(seen.items)) {
    if (!feedNames.has(item.source_name)) continue;
    const seenAt = new Date(item.seen_at);
    if (Number.isNaN(seenAt.getTime()) || dayKey(seenAt, timeZone) !== today) continue;
    const hour = hourOf(seenAt, timeZone);
    if (hour >= block.hours[0] && hour <= block.hours[1]) count += 1;
  }
  return count;
}

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function hourOf(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  return Number(hour) % 24;
}

// Dice coefficient over character bigrams: catches the same story reported by several outlets.
export function titleSimilarity(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function bigrams(value: string): Set<string> {
  const text = value.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) grams.add(text.slice(i, i + 2));
  return grams;
}

// Same story if the headlines are near-identical, or loosely similar while sharing a figure with a
// unit ("7.5억", "1220조", "283건"); bare years do not count.
export function sameStory(left: string, right: string): boolean {
  const similarity = titleSimilarity(left, right);
  if (similarity > 0.55) return true;
  if (similarity < 0.2) return false;
  const figures = new Set(figuresIn(left));
  return figuresIn(right).some((figure) => figures.has(figure));
}

function figuresIn(title: string): string[] {
  return (title.match(/\d[\d,.]*\s?(?:억|조|만|천|%|건|배|원|명|개|위|P|GB)/g) ?? []).map((value) => value.replace(/\s/g, ""));
}

export function dedupeByTitle<T extends { title: string }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const item of items) {
    if (!kept.some((other) => sameStory(item.title, other.title))) kept.push(item);
  }
  return kept;
}

const RECENT_STORY_MS = 72 * 3600_000;

function coveredRecently(item: SourceItem, seen: SeenStore, now: Date): boolean {
  return Object.values(seen.items).some(
    (entry) => now.getTime() - new Date(entry.seen_at).getTime() <= RECENT_STORY_MS && sameStory(item.title, entry.title)
  );
}

// Paragraphs longer than `max` sentences (the spice prompt asks for at most three).
export function overlongParagraphs(body: string, max = 3): number {
  return body
    .split(/\n\s*\n/)
    .filter((paragraph) => (paragraph.match(/[.!?。…]["'”’)\]]*(?=\s|$)/g) ?? []).length > max).length;
}

const QUESTIONS = {
  satire_potential: {
    type: "score",
    instructions:
      "How good is this news item as raw material for a sharp, mean Korean satirical column that ridicules a company, product, price, policy or executive using concrete facts?",
    criteria: [
      "Dull or purely informational; nothing specific to mock",
      "Some angle but thin, generic or sympathetic",
      "Clear target with some concrete details to mock",
      "Absurd, self-contradicting or arrogant target with concrete numbers, quotes or omissions"
    ]
  },
  topic: {
    type: "choice",
    instructions: "What is the main subject of this news item?",
    criteria: {
      corporate: "A company's product, service, price, outage, bug, pay, deal, or executive statement.",
      regulation: "A regulator's fine, probe, penalty, cartel or compliance matter about companies.",
      security: "A hacking, data breach, security flaw or cyber incident.",
      industry_policy:
        "Industry or technology statistics, market-share data, public procurement, government programs and budgets viewed as facts about an industry or spending, not as a politician's personal statement or dispute.",
      politics:
        "Statements, disputes, gaffes or apologies of individual politicians and officials, national assembly audits, elections, party conflict, diplomacy.",
      sports_ent: "Sports, entertainment, celebrities, games results.",
      war_crime: "War, military, crime, accidents, disasters, deaths.",
      other: "Anything else."
    }
  },
  politician_centered: {
    type: "noul",
    instructions:
      "Is the item mainly about an individual politician's or public official's statement, dispute, gaffe, apology or audit remark?",
    criteria: {
      true: "The item centers on what a politician or official said or argued.",
      false: "The item centers on a company, product, industry fact, or event."
    }
  },
  real_safety_harm: {
    type: "noul",
    instructions:
      "Does this involve a real physical safety hazard to people (building or structural defects, collapse risk, medical or sexual privacy violations, fatal or injury risk)?",
    criteria: {
      true: "Real safety hazard or serious privacy violation affecting people.",
      false: "No such hazard."
    }
  },
  unsafe_to_mock: {
    type: "noul",
    instructions:
      "Is the topic a tragedy, death, disaster, crime victim, or serious harm where mockery would be inappropriate?",
    criteria: {
      true: "Involves death, injury, violence, disaster, or victims.",
      false: "No such sensitive element."
    }
  }
} as const;

export interface ScoredCandidate {
  item: SourceItem;
  score: number;
}

export interface GateResult {
  passed: ScoredCandidate[];
  evaluated: number;
  notes: string[];
}

export async function gateSatireCandidates(
  config: RuntimeConfig,
  candidates: SourceItem[],
  now: Date,
  seen: SeenStore
): Promise<GateResult> {
  const notes: string[] = [];
  const fresh = candidates
    .filter((item) => !item.publishedAt || now.getTime() - new Date(item.publishedAt).getTime() <= MAX_AGE_MS)
    .filter((item) => !coveredRecently(item, seen, now))
    .sort((left, right) => time(right) - time(left));
  const pool = dedupeByTitle(fresh).slice(0, MAX_SCORED);

  const scored: ScoredCandidate[] = [];
  for (let i = 0; i < pool.length; i += JEV_CONCURRENCY) {
    const batch = pool.slice(i, i + JEV_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((item) => scoreOne(config, item)));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        notes.push(`jev failed: ${batch[index]?.title.slice(0, 40)}: ${String(result.reason).slice(0, 80)}`);
      } else if (result.value) {
        scored.push(result.value);
      } else {
        notes.push(`gate rejected: ${batch[index]?.title.slice(0, 60)}`);
      }
    });
  }

  const passed = scored
    .filter((entry) => entry.score >= config.satireGateMinScore)
    .sort((left, right) => right.score - left.score);
  return { passed, evaluated: pool.length, notes };
}

function time(item: SourceItem): number {
  return item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
}

type Answers = Record<string, { score?: number; noul?: number; choice?: string; probabilities?: Record<string, number> }>;

async function scoreOne(config: RuntimeConfig, item: SourceItem): Promise<ScoredCandidate | null> {
  const { response, text } = await fetchTextWithRetry(
    DECISIONS_URL,
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.openrouterApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: { source: item.feedName, title: item.title, summary: item.summary.slice(0, 600) },
        questions: QUESTIONS
      })
    },
    { label: "Jev decisions", timeoutMs: 20000, maxBytes: 65536, retries: 1 }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
  }

  const answers = (JSON.parse(text) as { answers?: Answers }).answers;
  if (!answers) {
    throw new Error("no answers");
  }

  const allowed = ALLOWED_TOPICS.reduce((sum, topic) => sum + (answers.topic?.probabilities?.[topic] ?? 0), 0);
  const blocked =
    (answers.unsafe_to_mock?.noul ?? 1) >= 0.5 ||
    (answers.real_safety_harm?.noul ?? 1) >= 0.5 ||
    (answers.politician_centered?.noul ?? 1) >= 0.5 ||
    allowed < 0.6;
  return blocked ? null : { item, score: answers.satire_potential?.score ?? 0 };
}

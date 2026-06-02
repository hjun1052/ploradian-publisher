import type { FactSummary, GeneratedArticleJson, SourceItem } from "./types";

const BANNED_HYPE_WORDS = [
  "충격",
  "경악",
  "대박",
  "폭소",
  "미쳤다",
  "난리났다",
  "네티즌 폭발",
  "ㅋㅋㅋ"
];

const BANNED_SECTION_HEADERS = [
  "현실 체념",
  "자기합리화",
  "회사식 화법",
  "짧은 인터뷰",
  "연관 개소리"
];

const CRIMINAL_TERMS = ["범죄", "사기", "횡령", "불법", "조작", "기소", "체포", "수사"];
const ALLOWED_CATEGORIES = new Set(["기술", "비즈니스", "시장", "헛소리"]);
const SATIRE_SIGNAL_TERMS = [
  "마치",
  "같다",
  "격이다",
  "셈이다",
  "꼴이다",
  "덕분에",
  "훌륭",
  "친절",
  "놀랍",
  "대단",
  "정중",
  "우아",
  "민망",
  "체면",
  "변명",
  "합리화"
];

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

export function validateGeneratedArticle(
  article: GeneratedArticleJson,
  source: SourceItem,
  facts: FactSummary,
  sourceText: string
): ValidationResult {
  const reasons: string[] = [];
  const title = article.title.trim();
  const body = article.body.trim();

  if (!title) {
    reasons.push("title is empty");
  }

  if (!body) {
    reasons.push("body is empty");
  }

  if (body.length < 520) {
    reasons.push("body is too short");
  }

  if (body.length > 5200) {
    reasons.push("body is too long");
  }

  if (body.length > 900 && countSatireSignals(`${title} ${article.subtitle} ${body}`) < 3) {
    reasons.push("satire is too polite; add sharper grounded ridicule, analogy, or irony");
  }

  if (!source.synthetic && article.category !== "헛소리" && body.length > 900 && concreteWeakPointHits(body, facts) < 1) {
    reasons.push("does not visibly attack any extracted weak point or mockable detail");
  }

  for (const word of BANNED_HYPE_WORDS) {
    if (title.includes(word) || body.includes(word)) {
      reasons.push(`contains banned cheap-hype word: ${word}`);
    }
  }

  for (const header of BANNED_SECTION_HEADERS) {
    if (body.includes(header)) {
      reasons.push(`contains prompt checklist header: ${header}`);
    }
  }

  if (!article.source_name.trim() || !article.source_url.trim() || !article.original_title.trim()) {
    reasons.push("source attribution fields are incomplete");
  }

  if (!ALLOWED_CATEGORIES.has(article.category.trim())) {
    reasons.push(`category must be one of 기술, 비즈니스, 시장, 헛소리: ${article.category}`);
  }

  if (!isProbablyUrl(article.source_url)) {
    reasons.push("source_url is not a valid URL");
  }

  if (!source.synthetic) {
    const sharedPhrase = findLongSharedPhrase(body, sourceText);
    if (sharedPhrase) {
      reasons.push(`appears to copy source phrase: ${sharedPhrase}`);
    }
  }

  const factualBasis = normalizeForSearch(
    [
      source.title,
      source.summary,
      facts.conflict_or_controversy,
      facts.money_stock_market_angle,
      facts.reader_relevance,
      ...facts.facts
    ].join(" ")
  );
  const generated = normalizeForSearch(`${title} ${body}`);
  for (const term of CRIMINAL_TERMS) {
    if (generated.includes(term) && !factualBasis.includes(term)) {
      reasons.push(`adds unsupported criminal/legal accusation term: ${term}`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons
  };
}

function countSatireSignals(value: string): number {
  return SATIRE_SIGNAL_TERMS.reduce((count, term) => count + (value.includes(term) ? 1 : 0), 0);
}

function concreteWeakPointHits(body: string, facts: FactSummary): number {
  const needles = [...facts.weak_points, ...facts.mockable_details, ...facts.corporate_euphemisms]
    .map((value) => value.trim())
    .filter((value) => value.length >= 4)
    .flatMap((value) => keywordFragments(value));

  const unique = new Set(needles);
  let hits = 0;
  for (const needle of unique) {
    if (body.includes(needle)) {
      hits += 1;
    }
  }
  return hits;
}

function keywordFragments(value: string): string[] {
  return value
    .replace(/[^\p{L}\p{N}\s.$%원달러-]/gu, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
    .slice(0, 4);
}

function findLongSharedPhrase(body: string, sourceText: string): string | null {
  const normalizedBody = normalizeForSearch(body).replace(/\s/g, "");
  const normalizedSource = normalizeForSearch(sourceText).replace(/\s/g, "");
  if (normalizedSource.length < 36 || normalizedBody.length < 36) {
    return null;
  }

  for (let index = 0; index <= normalizedSource.length - 34; index += 7) {
    const phrase = normalizedSource.slice(index, index + 34);
    if (phrase.length >= 34 && normalizedBody.includes(phrase)) {
      return `${phrase.slice(0, 28)}...`;
    }
  }

  return null;
}

function normalizeForSearch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isProbablyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

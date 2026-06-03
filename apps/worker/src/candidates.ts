import type { SourceItem } from "./types";

const COMMERCE_PATHS = ["/deals/", "/shopping/", "/coupons/", "/promo/"];

const DEAL_TERMS = [
  "deal",
  "deals",
  "discount",
  "sale",
  "save",
  "coupon",
  "promo",
  "off",
  "lowest price",
  "best price",
  "under $",
  "now $",
  "drops to",
  "prime day",
  "black friday",
  "cyber monday"
];

const COMMERCE_TERMS = [
  "amazon",
  "walmart",
  "best buy",
  "target",
  "shop",
  "shopping",
  "buy",
  "cart",
  "price",
  "priced",
  "retail",
  "$",
  "%"
];

const EVENT_LOGISTICS_TERMS = [
  "how to watch",
  "watch live",
  "livestream",
  "live stream",
  "live-stream",
  "where to watch",
  "when to watch",
  "keynote time",
  "conference schedule",
  "event schedule"
];

const COVERAGE_ONLY_TERMS = [
  "roundup",
  "all the news",
  "everything announced",
  "live blog",
  "live updates",
  "podcast",
  "newsletter",
  "watch",
  "hands-on",
  "review"
];

const TARGETABLE_FACT_TERMS = [
  "lawsuit",
  "sued",
  "ban",
  "blocked",
  "recall",
  "bug",
  "leak",
  "security",
  "privacy",
  "hack",
  "breach",
  "delay",
  "cancel",
  "shutdown",
  "closed",
  "price",
  "subscription",
  "fee",
  "paywall",
  "cost",
  "missing",
  "without",
  "failed",
  "failure",
  "controversy",
  "criticized",
  "order",
  "rule",
  "policy",
  "fine",
  "layoff",
  "cut",
  "소송",
  "금지",
  "차단",
  "리콜",
  "버그",
  "유출",
  "보안",
  "개인정보",
  "해킹",
  "지연",
  "취소",
  "종료",
  "가격",
  "요금",
  "비용",
  "구독",
  "빠진",
  "없다",
  "실패",
  "논란",
  "비판",
  "명령",
  "규제",
  "벌금",
  "해고",
  "감원",
  "철회",
  "중단"
];

export function candidateSkipReason(source: SourceItem): string | null {
  if (source.synthetic || source.category === "헛소리") {
    return null;
  }

  const url = parseUrl(source.url);
  const path = url?.pathname.toLowerCase() ?? "";
  if (COMMERCE_PATHS.some((segment) => path.includes(segment))) {
    return "shopping/deals source path";
  }

  const text = `${source.title} ${source.summary}`.toLowerCase();
  if (EVENT_LOGISTICS_TERMS.some((term) => text.includes(term))) {
    return "thin event viewing/logistics item";
  }

  const looksLikeDeal = DEAL_TERMS.some((term) => text.includes(term));
  const looksLikeShopping = COMMERCE_TERMS.some((term) => text.includes(term));

  if (looksLikeDeal && looksLikeShopping) {
    return "thin shopping deal item";
  }

  return null;
}

export function satireSuitabilitySkipReason(source: SourceItem, pageText: string): string | null {
  if (source.synthetic || source.category === "헛소리" || source.category === "정색" || source.securityPreyEvaluation) {
    return null;
  }

  const titleSummary = `${source.title} ${source.summary}`.toLowerCase();
  const fullText = `${source.title} ${source.summary} ${pageText}`.toLowerCase();
  const issueHits = TARGETABLE_FACT_TERMS.filter((term) => fullText.includes(term)).length;
  const numberHits = fullText.match(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?|\$\d+/g)?.length ?? 0;
  const coverageOnly = COVERAGE_ONLY_TERMS.some((term) => titleSummary.includes(term));

  if (coverageOnly && issueHits < 2 && numberHits < 2) {
    return "coverage-format item without enough targetable facts";
  }

  if (issueHits === 0 && numberHits < 2) {
    return "not enough targetable factual detail for satire";
  }

  if (pageText.trim().length < 240 && issueHits < 2 && numberHits < 2) {
    return "source text too thin to mock facts safely";
  }

  return null;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

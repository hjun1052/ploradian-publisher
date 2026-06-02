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
  const looksLikeDeal = DEAL_TERMS.some((term) => text.includes(term));
  const looksLikeShopping = COMMERCE_TERMS.some((term) => text.includes(term));

  if (looksLikeDeal && looksLikeShopping) {
    return "thin shopping deal item";
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

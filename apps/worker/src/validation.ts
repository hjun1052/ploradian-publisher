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
const UNSUPPORTED_INTENT_TERMS = ["고의로", "일부러", "작정하고", "속이려", "은폐하려", "공모"];
const ALLOWED_CATEGORIES = new Set(["기술", "비즈니스", "시장", "헛소리", "정색", "별들의 세계"]);
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
const SERIOUS_CRITIQUE_TERMS = [
  "우려",
  "시사점",
  "과제",
  "논란",
  "비판",
  "책임",
  "투명성",
  "윤리",
  "거버넌스",
  "균형",
  "숙제",
  "리스크",
  "문제 제기"
];
const JOKE_CARRIER_TERMS = [
  "무슨",
  "차라리",
  "덕분에",
  "친절하게도",
  "훌륭하게",
  "대단히",
  "정중하게",
  "마치",
  "같다",
  "격이다",
  "셈이다",
  "꼴이다",
  "분위기다",
  "놀라운",
  "민망",
  "변명",
  "체면",
  "회의실",
  "포장",
  "손잡이",
  "간판"
];
const DEADPAN_DEFENSE_TERMS = [
  "오히려",
  "덕분에",
  "합리적",
  "효율",
  "배려",
  "친절",
  "깔끔",
  "완성도",
  "장점",
  "성과",
  "전략",
  "품격",
  "훌륭",
  "정중",
  "선명",
  "안정적",
  "깨끗한 상태",
  "공식적으로"
];
const DIRECT_RIDICULE_TERMS = [
  "허술",
  "민망",
  "우습",
  "초라",
  "빈약",
  "빠졌",
  "없다",
  "못했다",
  "못한",
  "모른다",
  "아무것도",
  "대체",
  "결국",
  "핑계",
  "변명",
  "착각",
  "망설",
  "실패",
  "실망",
  "곤란"
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

  if (body.length < 420) {
    reasons.push("body is too short");
  }

  if (body.length > 4300) {
    reasons.push("body is too long");
  }

  if (article.category === "정색") {
    validateSeriousArticle(article, source, facts, title, body, reasons);
  } else if (article.category === "별들의 세계") {
    validateStarsArticle(article, source, facts, title, body, reasons);
  } else if (article.category === "헛소리" || source.synthetic) {
    if (article.category === "시장") {
      validateMarketNonsenseArticle(source, `${title}\n${article.subtitle}\n${body}`, body, reasons);
    } else if (source.syntheticFlavor && source.syntheticFlavor !== "nonsense") {
      validateSyntheticFeatureArticle(source, body, reasons);
    } else {
      validateNonsenseArticle(body, reasons);
    }
  } else {
    validateSatireArticle(article, source, facts, title, body, reasons);
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
    reasons.push(`category must be one of 기술, 비즈니스, 시장, 헛소리, 정색, 별들의 세계: ${article.category}`);
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

  for (const term of UNSUPPORTED_INTENT_TERMS) {
    if (generated.includes(term) && !factualBasis.includes(term)) {
      reasons.push(`adds unsupported motive/intent claim: ${term}`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons
  };
}

function validateStarsArticle(
  article: GeneratedArticleJson,
  source: SourceItem,
  facts: FactSummary,
  title: string,
  body: string,
  reasons: string[]
): void {
  if (body.length < 900) {
    reasons.push("별들의 세계 body is too short for a literary astronomy essay");
  }

  if (body.length > 3900) {
    reasons.push("별들의 세계 body is too long; keep the essay luminous and focused");
  }

  if (!source.astronomyEvaluation) {
    reasons.push("별들의 세계 source is missing astronomy evaluation");
  }

  const fullText = `${title} ${article.subtitle} ${body}`;
  if (countAstronomyTerms(fullText) < 4) {
    reasons.push("별들의 세계 lacks enough concrete astronomy language");
  }

  const requiredJudgments = [
    source.astronomyEvaluation?.primary_object,
    source.astronomyEvaluation?.scientific_anchor,
    source.astronomyEvaluation?.literary_axis
  ].filter((value): value is string => Boolean(value && value.length >= 4));
  const judgmentCoverage = requiredJudgments.length >= 2 ? briefCoverage(body, requiredJudgments) : 0;
  const groundingHits = concreteWeakPointHits(body, facts);
  if (groundingHits < 1 && judgmentCoverage < 1) {
    reasons.push("별들의 세계 does not use enough supplied scientific anchors");
  }

  if (countDirectRidicule(fullText) > 1) {
    reasons.push("별들의 세계 reads too much like ridicule");
  }

  if (/거지같|멍청|개판|등신|똥덩어리|조롱|비웃|까는|어그로/.test(fullText)) {
    reasons.push("별들의 세계 contains satire-column diction");
  }

  if (countMatches(fullText, /주가|증시|시장|투자|기업|소비자|고객|플랫폼|정책/g) > 3) {
    reasons.push("별들의 세계 drifted into market/business/policy framing");
  }

  if (requiredJudgments.length >= 2 && judgmentCoverage < 1 && groundingHits < 1) {
    reasons.push("별들의 세계 body does not reflect astronomy evaluation fields");
  }

  if (article.category !== "별들의 세계") {
    reasons.push("별들의 세계 article must keep category exactly 별들의 세계");
  }
}

function validateSeriousArticle(
  article: GeneratedArticleJson,
  source: SourceItem,
  facts: FactSummary,
  title: string,
  body: string,
  reasons: string[]
): void {
  if (body.length < 900) {
    reasons.push("정색 body is too short for a serious critical column");
  }

  if (body.length > 4600) {
    reasons.push("정색 body is too long; keep the criticism focused");
  }

  if (countJokeCarriers(`${title} ${article.subtitle} ${body}`) > 7 || countDeadpanDefense(body) > 8) {
    reasons.push("정색 article reads too much like satire");
  }

  const bannedCliches = [
    "향후 논란",
    "귀추가 주목",
    "투명성이 필요",
    "업계의 과제",
    "사회적 논의",
    "신중한 접근",
    "균형 있는 접근",
    "시사점을 남긴다"
  ];
  for (const cliche of bannedCliches) {
    if (body.includes(cliche) || title.includes(cliche)) {
      reasons.push(`정색 contains banned column cliche: ${cliche}`);
    }
  }

  const groundingHits = concreteWeakPointHits(body, facts);
  if (groundingHits < 2) {
    reasons.push("정색 does not use enough supplied hidden-cost or who-pays facts");
  }

  const requiredPerspectiveTerms = [
    source.seriousEvaluation?.who_pays,
    source.seriousEvaluation?.hidden_cost,
    source.seriousEvaluation?.missing_question
  ].filter((value): value is string => Boolean(value && value.length >= 4));
  if (requiredPerspectiveTerms.length >= 2 && briefCoverage(body, requiredPerspectiveTerms) < 2) {
    reasons.push("정색 body does not reflect enough editorial judgment fields");
  }

  if (article.satire_brief.must_include_jabs.length < 4) {
    reasons.push("정색 brief must include at least four grounded critical points");
  }

  if (!source.seriousEvaluation) {
    reasons.push("정색 source is missing editorial evaluation");
  }
}

function validateNonsenseArticle(body: string, reasons: string[]): void {
  if (body.length > 2200) {
    reasons.push("헛소리 body is too long; keep anti-news short enough to stay pointless");
  }

  if (countSeriousCritiqueTerms(body) > 2) {
    reasons.push("헛소리 contains too many serious critique terms");
  }

  const usefulTerms = ["업계", "시장", "소비자", "전략", "기술", "플랫폼", "정책", "투명성", "리스크", "교훈", "시사점"];
  for (const term of usefulTerms) {
    if (body.includes(term)) {
      reasons.push(`헛소리 should not become useful commentary: ${term}`);
    }
  }
}

function validateSyntheticFeatureArticle(source: SourceItem, body: string, reasons: string[]): void {
  if (body.length > 3200) {
    reasons.push(`${source.syntheticFlavor ?? "synthetic"} body is too long; keep the weekend feature punchy`);
  }

  if (source.syntheticFlavor === "weekend-fable" && /주가|등락률|코스피|나스닥|매수|매도/.test(body)) {
    reasons.push("weekend fable should stay away from stock-market framing");
  }
}

function validateMarketNonsenseArticle(source: SourceItem, fullText: string, body: string, reasons: string[]): void {
  if (body.length > 2800) {
    reasons.push("market nonsense body is too long; keep the fake recap punchy");
  }

  const rows = parseMarketRows(source.summary);
  const percentages = rows.map((row) => row.change);
  const missing = [...new Set(percentages)].filter((percent) => !body.includes(percent));
  if (missing.length > 0) {
    reasons.push(`market nonsense must preserve supplied percentages: ${missing.join(", ")}`);
  }

  if (!source.syntheticFlavor || source.syntheticFlavor === "market-close") {
    for (const row of rows) {
      const withoutCorrectPercent = fullText.split(row.change).join("");
      const absolute = row.change.replace(/^[+-]/, "");
      if (row.change.startsWith("-") && hasForbiddenPercentVariant(withoutCorrectPercent, absolute, "+")) {
        reasons.push(`market nonsense flipped negative percentage for ${row.name}: ${row.change}`);
      }
      if (row.change.startsWith("+") && hasForbiddenPercentVariant(withoutCorrectPercent, absolute, "-")) {
        reasons.push(`market nonsense flipped positive percentage for ${row.name}: ${row.change}`);
      }

      const related = marketRowContext(fullText, row.name, row.change);
      if (row.change.startsWith("-") && hasPositiveMoveWord(related) && !hasNegativeMoveWord(related)) {
        reasons.push(`market nonsense describes negative mover as rising: ${row.name} ${row.change}`);
      }
      if (row.change.startsWith("+") && hasNegativeMoveWord(related) && !hasPositiveMoveWord(related)) {
        reasons.push(`market nonsense describes positive mover as falling: ${row.name} ${row.change}`);
      }
    }
  }

  if (source.syntheticFlavor === "market-holiday") {
    if (countMatches(body, /주주|보유자|단톡|계좌|평단|물타기|존버|자기합리화/g) < 5) {
      reasons.push("market holiday must focus on holder psychology, not stock movement excuses");
    }
    if (/오늘\s+(?:올랐|내렸)|움직였|해석된다|원인|탓으로|덕분에|마감판/.test(body)) {
      reasons.push("market holiday should not explain stock moves; predict holder status instead");
    }
  }

  const normalMarketTerms = [
    "금리",
    "실적",
    "업황",
    "외국인 순매수",
    "외국인 순매도",
    "기관 순매수",
    "기관 순매도",
    "투자심리",
    "밸류에이션",
    "가이던스",
    "인플레이션",
    "물가",
    "경기침체",
    "섹터 로테이션",
    "차익실현",
    "수급"
  ];
  for (const term of normalMarketTerms) {
    if (body.includes(term)) {
      reasons.push(`market nonsense used normal market explanation: ${term}`);
    }
  }
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function parseMarketRows(summary: string): Array<{ name: string; symbol: string; change: string }> {
  return summary
    .split("\n")
    .map((line) => /^-\s+(.+?)\s+\((.+?)\):\s+.+?,\s+([+-]\d+(?:\.\d+)?%)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({
      name: match[1] ?? "",
      symbol: match[2] ?? "",
      change: match[3] ?? ""
    }))
    .filter((row) => Boolean(row.name && row.symbol && row.change));
}

function hasForbiddenPercentVariant(text: string, absolutePercent: string, sign: "+" | "-"): boolean {
  if (text.includes(`${sign}${absolutePercent}`)) {
    return true;
  }

  if (sign === "+") {
    return false;
  }

  const escaped = escapeRegExp(absolutePercent);
  return new RegExp(`(^|[^+\\-\\d.])${escaped}(?![\\d.])`).test(text);
}

function marketRowContext(text: string, name: string, change: string): string {
  return text
    .split(/\n{2,}|(?<=[.!?。])\s+/)
    .filter((part) => part.includes(name) || part.includes(change))
    .join(" ");
}

function hasPositiveMoveWord(value: string): boolean {
  return /올랐|오른|올라|상승|뛰었|튀었|위로|부풀|들어 올|끌어올/.test(value);
}

function hasNegativeMoveWord(value: string): boolean {
  return /내렸|내린|내려|하락|떨어|빠졌|아래|지하|내리막|음전/.test(value);
}

function validateSatireArticle(
  article: GeneratedArticleJson,
  source: SourceItem,
  facts: FactSummary,
  title: string,
  body: string,
  reasons: string[]
): void {
  if (body.length > 700 && countSatireSignals(`${title} ${article.subtitle} ${body}`) < 3) {
    reasons.push("satire is too polite; add sharper grounded ridicule, analogy, or irony");
  }

  if (body.length > 700 && countJokeCarriers(`${title} ${article.subtitle} ${body}`) < 4) {
    reasons.push("article reads like serious criticism; add more visible jokes, ridicule carriers, and absurd analogies");
  }

  if (body.length > 700 && countDeadpanDefense(`${title} ${article.subtitle} ${body}`) < 2 && countDirectRidicule(`${title} ${article.subtitle} ${body}`) < 4) {
    reasons.push("article lacks direct bite or deadpan ridicule; name the stupid part more plainly");
  }

  if (body.length > 700 && countSeriousCritiqueTerms(body) > 5) {
    reasons.push("too many serious critique terms; reduce policy-column cadence and increase mockery");
  }

  if (!source.synthetic && body.length > 700) {
    const concreteHits = concreteWeakPointHits(body, facts);
    if (concreteHits < 3) {
      reasons.push("does not visibly attack enough extracted weak points or mockable source details");
    }
    if (concreteHits < 5 && analogyLoad(body) > 7) {
      reasons.push("too much analogy for too little source detail; replace broad metaphors with concrete attacks");
    }
  }

  if (!source.synthetic && attacksSourceCoverageItself(`${title}\n${article.subtitle}\n${body}`, source)) {
    reasons.push("satire attacks the source article, outlet, reporter, wording, or coverage format instead of the facts being reported");
  }

  if (!source.synthetic && body.length > 700 && countDirectRidicule(`${title} ${article.subtitle} ${body}`) < 3) {
    reasons.push("satire is not biting enough; add blunt source-specific ridicule");
  }

  if (article.satire_brief.straight_faced_defense.length < 2) {
    reasons.push("satire_brief must include at least two straight-faced defense lines");
  }

  const minimumJabs = source.synthetic ? 3 : 4;
  if (article.satire_brief.must_include_jabs.length < minimumJabs) {
    reasons.push(`satire_brief must include at least ${minimumJabs} concrete jabs`);
  }

  if (article.satire_brief.analogies.length < 2) {
    reasons.push("satire_brief must include at least two analogies");
  }

  if (
    article.satire_brief.straight_faced_defense.length >= 2 &&
    briefCoverage(body, article.satire_brief.straight_faced_defense) < 1
  ) {
    reasons.push("body does not use enough straight-faced defense lines");
  }

  if (article.satire_brief.must_include_jabs.length >= minimumJabs && briefCoverage(body, article.satire_brief.must_include_jabs) < 3) {
    reasons.push("body does not use enough satire_brief jabs");
  }

  if (article.satire_brief.analogies.length >= 2 && briefCoverage(body, article.satire_brief.analogies) < 1) {
    reasons.push("body does not use enough satire_brief analogies");
  }
}

function attacksSourceCoverageItself(text: string, source: SourceItem): boolean {
  const outletTerms = source.feedName
    .split(/[\/\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  const sourceTerms = [
    "기사",
    "원문",
    "보도",
    "매체",
    "기자",
    "문장",
    "제목",
    "글",
    "보도자료",
    "라운드업",
    "라이브블로그",
    ...outletTerms
  ];
  const attackTerms = [
    "거지같",
    "멍청",
    "개판",
    "똥덩어리",
    "등신",
    "허술",
    "빈약",
    "민망",
    "우습",
    "대체",
    "아무것도",
    "핑계",
    "변명",
    "문장으로 덮",
    "형식만",
    "내용 없이",
    "성실하게 덮"
  ];

  return text
    .split(/\n+|(?<=[.!?。])\s+|(?<=다\.)\s+/)
    .some((sentence) => {
      const normalized = sentence.toLowerCase();
      const hasSourceTerm = sourceTerms.some((term) => term && normalized.includes(term.toLowerCase()));
      const hasAttackTerm = attackTerms.some((term) => normalized.includes(term.toLowerCase()));
      return hasSourceTerm && hasAttackTerm;
    });
}

function countSatireSignals(value: string): number {
  return SATIRE_SIGNAL_TERMS.reduce((count, term) => count + (value.includes(term) ? 1 : 0), 0);
}

function countJokeCarriers(value: string): number {
  return JOKE_CARRIER_TERMS.reduce((count, term) => count + (value.includes(term) ? 1 : 0), 0);
}

function countDeadpanDefense(value: string): number {
  return DEADPAN_DEFENSE_TERMS.reduce((count, term) => count + (value.includes(term) ? 1 : 0), 0);
}

function countDirectRidicule(value: string): number {
  return DIRECT_RIDICULE_TERMS.reduce((count, term) => count + occurrences(value, term), 0);
}

function countSeriousCritiqueTerms(value: string): number {
  return SERIOUS_CRITIQUE_TERMS.reduce((count, term) => count + occurrences(value, term), 0);
}

function countAstronomyTerms(value: string): number {
  const terms = [
    "별",
    "항성",
    "은하",
    "행성",
    "성운",
    "블랙홀",
    "혜성",
    "소행성",
    "달",
    "태양",
    "빛",
    "중력",
    "궤도",
    "대기",
    "자기장",
    "망원경",
    "관측",
    "광년",
    "우주",
    "초신성",
    "Webb",
    "Hubble",
    "JWST",
    "ESA",
    "NASA"
  ];
  return terms.reduce((count, term) => count + occurrences(value, term), 0);
}

function analogyLoad(value: string): number {
  return ["마치", "같다", "같은", "격이다", "셈이다", "꼴이다", "비슷하다"].reduce(
    (count, term) => count + occurrences(value, term),
    0
  );
}

function briefCoverage(body: string, lines: string[]): number {
  let hits = 0;
  for (const line of lines) {
    const fragments = keywordFragments(line);
    if (fragments.some((fragment) => body.includes(fragment))) {
      hits += 1;
    }
  }
  return hits;
}

function occurrences(value: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  return value.split(needle).length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

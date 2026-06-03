import type { Article } from "./articles";

const FEATURED_CATEGORY_LIMIT = 4;

const strongHeadlineTerms = [
  /유출|털렸|해킹|비인가|개인정보|보안/,
  /폭등|급등|급락|하락|상승|음전|양전|시간외|마감/,
  /실패|못했|빠졌|없었|늦었|무너|흔들|포기|거절/,
  /명령|규제|소송|조사|신고|책임|피해|보상/,
  /가격|할인|요금|구독|매출|순익|현금|자사주/,
  /AI|OpenAI|마이크로소프트|구글|메타|삼성|티빙|트럼프/i
];

const hookShapeTerms = [
  /는데도|했지만|라더니|갑자기|끝내|먼저|나중에/,
  /드라마|스릴러|성적표|계좌|결말|변명|선언문/,
  /왜|무슨|어떻게|누가|얼마나/
];

const blandTerms = [/소식|발표|공개|소개|업데이트/];

export function getHomeFeaturedArticles(articles: Article[], count: number): Article[] {
  const ranked = rankHomeArticles(articles);
  const selected: Article[] = [];
  const categoryCounts = new Map<string, number>();

  for (const rankedArticle of ranked) {
    if (selected.length >= count) {
      break;
    }

    const categoryCount = categoryCounts.get(rankedArticle.article.category) ?? 0;
    if (categoryCount >= FEATURED_CATEGORY_LIMIT && hasOtherCategoryCandidate(ranked, selected, categoryCounts)) {
      continue;
    }

    selected.push(rankedArticle.article);
    categoryCounts.set(rankedArticle.article.category, categoryCount + 1);
  }

  if (selected.length < count) {
    for (const rankedArticle of ranked) {
      if (selected.length >= count) {
        break;
      }
      if (!selected.includes(rankedArticle.article)) {
        selected.push(rankedArticle.article);
      }
    }
  }

  return selected;
}

export function rankHomeArticles(articles: Article[]): Array<{ article: Article; score: number }> {
  const referenceTime = Math.max(...articles.map((article) => articleTimestamp(article)).filter(Number.isFinite));

  return articles
    .map((article) => ({
      article,
      score: homeArticleScore(article, referenceTime)
    }))
    .sort((left, right) => right.score - left.score || articleTimestamp(right.article) - articleTimestamp(left.article));
}

function homeArticleScore(article: Article, referenceTime: number): number {
  return recencyScore(article, referenceTime) + headlineScore(article) + categoryPulseScore(article);
}

function recencyScore(article: Article, referenceTime: number): number {
  const hoursOld = Math.max(0, (referenceTime - articleTimestamp(article)) / 3_600_000);
  if (!Number.isFinite(hoursOld)) {
    return 0;
  }

  if (hoursOld <= 2) {
    return 54;
  }

  if (hoursOld <= 24) {
    return 54 - (hoursOld - 2) * 1.35;
  }

  if (hoursOld <= 72) {
    return 24.3 - (hoursOld - 24) * 0.38;
  }

  return Math.max(0, 6 - (hoursOld - 72) * 0.05);
}

function headlineScore(article: Article): number {
  const title = article.title.trim();
  const subtitle = article.subtitle.trim();
  const combined = `${title} ${subtitle}`;
  let score = 0;

  score += titleLengthScore(title.length);
  score += Math.min(28, countMatches(combined, strongHeadlineTerms) * 6);
  score += Math.min(14, countMatches(title, hookShapeTerms) * 5);
  score += /\d|[+−-]\d|%|달러|원|억|조/.test(combined) ? 8 : 0;
  score += /[,:…]|\.{2,}|·/.test(title) ? 4 : 0;
  score += article.image_url ? 2 : 0;
  score -= Math.min(9, countMatches(title, blandTerms) * 3);

  return score;
}

function titleLengthScore(length: number): number {
  if (length >= 22 && length <= 68) {
    return 14;
  }

  if (length >= 14 && length <= 84) {
    return 8;
  }

  return 1;
}

function categoryPulseScore(article: Article): number {
  if (article.category === "정색") {
    return 5;
  }

  if (article.category === "기술" && /보안|유출|해킹|개인정보/.test(`${article.title} ${article.subtitle}`)) {
    return 7;
  }

  if (article.category === "시장" && /\d|%|급등|급락|마감|시간외/.test(`${article.title} ${article.subtitle}`)) {
    return 4;
  }

  return 0;
}

function countMatches(value: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function articleTimestamp(article: Article): number {
  const time = new Date(article.date).getTime();
  return Number.isFinite(time) ? time : 0;
}

function hasOtherCategoryCandidate(
  ranked: Array<{ article: Article; score: number }>,
  selected: Article[],
  categoryCounts: Map<string, number>
): boolean {
  return ranked.some(({ article }) => {
    if (selected.includes(article)) {
      return false;
    }
    return (categoryCounts.get(article.category) ?? 0) < FEATURED_CATEGORY_LIMIT;
  });
}

import { fetchTextWithRetry } from "./http";
import type { SourceItem } from "./types";

const KOREA_MARKET_HOUR = 16;
const US_MARKET_HOUR = 7;
const KOREA_QUOTE_LIMIT = 16;
const US_QUOTE_LIMIT = 12;

interface MarketQuoteTarget {
  name: string;
  symbol: string;
  business?: string;
  jokeSeed?: string;
}

interface MarketQuote {
  name: string;
  symbol: string;
  price: number;
  changePercent: number;
  business?: string;
  jokeSeed?: string;
}

const KOREA_FALLBACK_TARGETS: MarketQuoteTarget[] = [
  { name: "삼성전자", symbol: "005930", business: "반도체와 스마트폰", jokeSeed: "칩, 갤럭시, 전자레인지 아닌 전자" },
  { name: "SK하이닉스", symbol: "000660", business: "메모리 반도체", jokeSeed: "하이와 닉스, 메모리, 저장장치" },
  { name: "삼성전자우", symbol: "005935", business: "삼성전자 우선주", jokeSeed: "우선권, 줄서기, 본주 옆자리" },
  { name: "SK스퀘어", symbol: "402340", business: "투자 지주회사", jokeSeed: "사각형, 네 귀퉁이, 투자 바구니" },
  { name: "현대차", symbol: "005380", business: "자동차", jokeSeed: "핸들, 기어, 후진과 전진" },
  { name: "삼성전기", symbol: "009150", business: "전자부품", jokeSeed: "부품, 전기, 콘센트" },
  { name: "LG에너지솔루션", symbol: "373220", business: "배터리", jokeSeed: "충전, 방전, 배터리 잔량" },
  { name: "삼성생명", symbol: "032830", business: "생명보험", jokeSeed: "보험 약관, 생명, 만기" },
  { name: "삼성물산", symbol: "028260", business: "건설과 상사", jokeSeed: "물산, 물건 산, 공사장" },
  { name: "HD현대중공업", symbol: "329180", business: "조선과 중공업", jokeSeed: "배, 조선소, 용접봉" },
  { name: "현대모비스", symbol: "012330", business: "자동차 부품", jokeSeed: "모비스, 부품함, 범퍼" },
  { name: "기아", symbol: "000270", business: "자동차", jokeSeed: "기어, 시동, 주차장" },
  { name: "두산에너빌리티", symbol: "034020", business: "발전 설비", jokeSeed: "발전소, 에너지, 터빈" },
  { name: "LG전자", symbol: "066570", business: "가전과 전자제품", jokeSeed: "세탁기, 냉장고, 리모컨" },
  { name: "삼성바이오로직스", symbol: "207940", business: "바이오 의약품 위탁생산", jokeSeed: "배양기, 실험실, 로직스" },
  { name: "KB금융", symbol: "105560", business: "은행과 금융지주", jokeSeed: "통장, 금고, 번호표" },
  { name: "에코프로비엠", symbol: "247540", business: "2차전지 소재", jokeSeed: "에코, 양극재, 친환경인 척하는 금속" },
  { name: "알테오젠", symbol: "196170", business: "바이오 플랫폼", jokeSeed: "알, 테오, 실험실 이름표" },
  { name: "에코프로", symbol: "086520", business: "2차전지 소재 지주", jokeSeed: "에코, 프로, 배터리 재료" },
  { name: "레인보우로보틱스", symbol: "277810", business: "로봇", jokeSeed: "무지개, 로봇 팔, 색깔별 관절" }
];

const US_TARGETS: MarketQuoteTarget[] = [
  { name: "S&P 500", symbol: "^spx", business: "미국 대형주 지수", jokeSeed: "500명이 한꺼번에 출석하는 반" },
  { name: "나스닥", symbol: "^ndq", business: "기술주 중심 지수", jokeSeed: "기술주 단톡방, 전광판" },
  { name: "다우", symbol: "^dji", business: "미국 대표 우량주 지수", jokeSeed: "오래된 정장, 다우라는 성씨" },
  { name: "엔비디아", symbol: "nvda.us", business: "GPU와 AI 칩", jokeSeed: "그래픽카드, 팬 소리, 젠슨의 가죽 재킷" },
  { name: "애플", symbol: "aapl.us", business: "아이폰과 소비자 하드웨어", jokeSeed: "사과, 충전 케이블, 발표장 박수" },
  { name: "마이크로소프트", symbol: "msft.us", business: "윈도우와 클라우드", jokeSeed: "창문, 엑셀 셀, 업데이트 재부팅" },
  { name: "테슬라", symbol: "tsla.us", business: "전기차", jokeSeed: "충전소, 핸들, 자동주행 척" },
  { name: "메타", symbol: "meta.us", business: "소셜미디어와 AI", jokeSeed: "페이스북, 인스타, 메타버스 빈 회의실" },
  { name: "알파벳", symbol: "googl.us", business: "검색과 광고", jokeSeed: "알파벳 순서, 검색창, 자동완성" },
  { name: "아마존", symbol: "amzn.us", business: "전자상거래와 클라우드", jokeSeed: "상자, 배송기사, 장바구니" }
];

export async function scheduledMarketCandidate(now: Date, timeZone: string): Promise<SourceItem | null> {
  const slot = zonedSlot(now, timeZone);

  if (slot.hour === KOREA_MARKET_HOUR) {
    return koreaMarketCandidate(slot);
  }

  if (slot.hour === US_MARKET_HOUR) {
    return usMarketCandidate(slot);
  }

  return null;
}

export async function forcedMarketCandidate(
  market: "korea" | "us",
  now: Date,
  timeZone: string
): Promise<SourceItem | null> {
  const slot = zonedSlot(now, timeZone);
  if (market === "korea") {
    return koreaMarketCandidate({ ...slot, hour: KOREA_MARKET_HOUR });
  }

  return usMarketCandidate({ ...slot, hour: US_MARKET_HOUR });
}

async function koreaMarketCandidate(slot: { day: string; hour: number; offset: string }): Promise<SourceItem | null> {
  const quotes = await fetchKoreaQuotes(await koreaMarketCapTargets());
  return marketCandidate("국장", slot, quotes);
}

async function usMarketCandidate(slot: { day: string; hour: number; offset: string }): Promise<SourceItem | null> {
  const quotes = await fetchUsQuotes(US_TARGETS);
  return marketCandidate("미장", slot, quotes);
}

async function koreaMarketCapTargets(): Promise<MarketQuoteTarget[]> {
  const [kospi, kosdaq] = await Promise.all([
    fetchNaverMarketCapTargets(0, 16),
    fetchNaverMarketCapTargets(1, 8)
  ]);
  const targets = dedupeTargets([
    ...kospi.slice(0, 14),
    ...kosdaq.slice(0, 6),
    ...KOREA_FALLBACK_TARGETS
  ]);
  return targets.slice(0, 22);
}

async function fetchNaverMarketCapTargets(sosok: 0 | 1, limit: number): Promise<MarketQuoteTarget[]> {
  const url = new URL("https://finance.naver.com/sise/sise_market_sum.naver");
  url.searchParams.set("sosok", String(sosok));
  url.searchParams.set("page", "1");

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        accept: "text/html,*/*;q=0.5",
        "user-agent": "The Ploradian bot/0.1 (+https://news.ploradian.com/about/)"
      }
    }, 7000);
    if (!response.ok) {
      return [];
    }

    const bytes = await response.arrayBuffer();
    const html = decodeKoreanHtml(bytes);
    const matches = html.matchAll(/<a href="\/item\/main\.naver\?code=(\d{6})"[^>]*class="tltle"[^>]*>([^<]+)<\/a>/g);
    const targets: MarketQuoteTarget[] = [];
    for (const match of matches) {
      const symbol = match[1]?.trim();
      const name = decodeHtmlEntities(match[2]?.trim() ?? "");
      if (symbol && name) {
        targets.push({ symbol, name });
      }
      if (targets.length >= limit) {
        break;
      }
    }
    return targets;
  } catch {
    return [];
  }
}

async function fetchKoreaQuotes(targets: MarketQuoteTarget[]): Promise<MarketQuote[]> {
  const settled = await Promise.allSettled(targets.map(fetchNaverQuote));
  return settled.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []));
}

async function fetchNaverQuote(target: MarketQuoteTarget): Promise<MarketQuote | null> {
  const url = new URL(`https://m.stock.naver.com/api/stock/${target.symbol}/basic`);
  const { response, text } = await fetchTextWithRetry(
    url,
    {
      headers: {
        accept: "application/json,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "The Ploradian bot/0.1 (+https://news.ploradian.com/about/)"
      }
    },
    {
      label: `Naver Finance quote ${target.symbol}`,
      timeoutMs: 5000,
      maxBytes: 32768,
      retries: 1
    }
  );

  if (!response.ok) {
    return null;
  }

  const quote = JSON.parse(text) as NaverBasicResponse;
  const price = parseMarketNumber(quote.closePrice);
  const changePercent = Number(quote.fluctuationsRatio);
  if (!Number.isFinite(price) || !Number.isFinite(changePercent)) {
    return null;
  }

  const name = quote.stockName || target.name;
  const profile = marketProfile({ ...target, name });
  return {
    name,
    symbol: target.symbol,
    price,
    changePercent,
    business: profile.business ?? "시총 상위 기업",
    jokeSeed: profile.jokeSeed ?? `${name}이라는 이름 자체`
  };
}

async function fetchUsQuotes(targets: MarketQuoteTarget[]): Promise<MarketQuote[]> {
  const settled = await Promise.allSettled(targets.map(fetchStooqQuote));
  return settled.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []));
}

async function fetchStooqQuote(target: MarketQuoteTarget): Promise<MarketQuote | null> {
  const url = new URL("https://stooq.com/q/l/");
  url.searchParams.set("s", target.symbol);
  url.searchParams.set("f", "sd2t2ohlcv");
  url.searchParams.set("h", "");
  url.searchParams.set("e", "csv");
  const { response, text } = await fetchTextWithRetry(
    url,
    {
      headers: {
        accept: "text/csv,text/plain;q=0.8,*/*;q=0.5",
        "user-agent": "The Ploradian bot/0.1 (+https://news.ploradian.com/about/)"
      }
    },
    {
      label: `Stooq quote ${target.symbol}`,
      timeoutMs: 5000,
      maxBytes: 8192,
      retries: 1
    }
  );

  if (!response.ok) {
    return null;
  }

  const parts = text.trim().split(/\r?\n/).at(-1)?.split(",") ?? [];
  const open = Number(parts[3]);
  const close = Number(parts[6]);
  if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0) {
    return null;
  }

  return {
    name: target.name,
    symbol: target.symbol,
    price: close,
    changePercent: ((close - open) / open) * 100,
    business: target.business ?? "미국 시장 구성 종목",
    jokeSeed: target.jokeSeed ?? target.name
  };
}

function marketCandidate(market: "국장" | "미장", slot: { day: string; hour: number; offset: string }, quotes: MarketQuote[]): SourceItem | null {
  const usable = quotes
    .filter((quote) => Number.isFinite(quote.changePercent))
    .slice(0, market === "국장" ? KOREA_QUOTE_LIMIT : US_QUOTE_LIMIT);
  if (usable.length < 3) {
    return null;
  }

  const slotId = `${slot.day}-${market}-${String(slot.hour).padStart(2, "0")}`;
  const url = `https://news.ploradian.com/market/${slotId}/`;
  const lines = usable.map(
    (quote) => [
      `- ${quote.name} (${quote.symbol}): ${formatPrice(quote.price)}, ${formatChange(quote.changePercent)}`,
      `하는 일: ${quote.business ?? "업종 단서 없음"}`,
      `드립 재료: ${quote.jokeSeed ?? quote.name}`
    ].join(" | ")
  );

  return {
    feedName: `The Ploradian ${market} 마감 억지해석 데스크`,
    feedUrl: "https://news.ploradian.com/archive/?category=%EC%8B%9C%EC%9E%A5",
    category: "시장",
    title: `${slot.day} ${market} 마감 억지해석`,
    url,
    canonicalUrl: url,
    summary: [
      `${market} 마감 숫자만 실제 데이터로 고정한다.`,
      "등락 이유는 금융적 해석을 금지하고, 종목명 말장난과 되도 않는 사유만 붙인다.",
      "실제 등락률은 바꾸지 않는다.",
      ...lines
    ].join("\n"),
    publishedAt: `${slot.day}T${String(slot.hour).padStart(2, "0")}:00:00${slot.offset}`,
    synthetic: true
  };
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("ko-KR") : value.toFixed(2);
}

function formatChange(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function zonedSlot(date: Date, timeZone: string): { day: string; hour: number; offset: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24;
  const localAsUtc = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    hour,
    Number(get("minute")),
    Number(get("second"))
  );
  const offsetMinutes = Math.round((localAsUtc - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offsetHour = String(Math.floor(absolute / 60)).padStart(2, "0");
  const offsetMinute = String(absolute % 60).padStart(2, "0");

  return {
    day,
    hour,
    offset: `${sign}${offsetHour}:${offsetMinute}`
  };
}

interface NaverBasicResponse {
  stockName?: string;
  closePrice?: string;
  fluctuationsRatio?: string;
}

function dedupeTargets(targets: MarketQuoteTarget[]): MarketQuoteTarget[] {
  const seen = new Set<string>();
  const output: MarketQuoteTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.symbol)) {
      continue;
    }
    seen.add(target.symbol);
    output.push(marketProfile(target));
  }
  return output;
}

function marketProfile(target: MarketQuoteTarget): MarketQuoteTarget {
  if (target.business && target.jokeSeed) {
    return target;
  }

  const name = target.name.toLowerCase();
  if (target.symbol === "005930" || name.includes("삼성전자")) {
    return { ...target, business: "반도체와 스마트폰", jokeSeed: "칩, 갤럭시, 전자라는 과하게 넓은 이름" };
  }
  if (target.symbol === "000660" || name.includes("하이닉스")) {
    return { ...target, business: "메모리 반도체", jokeSeed: "하이와 닉스, 저장한 줄 알았는데 까먹은 메모리" };
  }
  if (name.includes("스퀘어")) {
    return { ...target, business: "투자 지주회사", jokeSeed: "사각형, 네 귀퉁이, 투자 바구니" };
  }
  if (name.includes("전자우")) {
    return { ...target, business: "삼성전자 우선주", jokeSeed: "우선권, 본주 옆자리, 번호표" };
  }
  if (name.includes("전기")) {
    return { ...target, business: "전자부품", jokeSeed: "콘센트, 부품함, 전기가 오른 척하는 이름" };
  }
  if (name.includes("에너지") || name.includes("배터리") || name.includes("에코프로")) {
    return { ...target, business: "2차전지와 에너지 소재", jokeSeed: "충전, 방전, 양극재, 이름만 들어도 친환경인 척" };
  }
  if (name.includes("현대차") || name === "기아" || name.includes("모비스")) {
    return { ...target, business: "자동차와 부품", jokeSeed: "기어, 후진, 전진, 주차장, 범퍼" };
  }
  if (name.includes("바이오") || name.includes("셀트리온") || name.includes("알테오젠")) {
    return { ...target, business: "바이오와 의약품", jokeSeed: "배양기, 실험실, 알 수 없는 흰 가운의 자신감" };
  }
  if (name.includes("금융") || name.includes("은행") || name.includes("증권")) {
    return { ...target, business: "금융", jokeSeed: "통장, 금고, 번호표, 창구 직원의 무표정" };
  }
  if (name.includes("생명")) {
    return { ...target, business: "생명보험", jokeSeed: "보험 약관, 만기일, 생명이라는 너무 큰 단어" };
  }
  if (name.includes("물산")) {
    return { ...target, business: "건설과 상사", jokeSeed: "물건을 산 것 같은 이름, 공사장 안전모, 상사 책상" };
  }
  if (name.includes("중공업") || name.includes("조선")) {
    return { ...target, business: "조선과 중공업", jokeSeed: "조선소, 용접봉, 너무 큰 쇳덩어리" };
  }
  if (name.includes("로보틱스") || name.includes("로봇")) {
    return { ...target, business: "로봇", jokeSeed: "로봇 팔, 관절, 무지개 색 케이블" };
  }
  if (name.includes("네이버") || name.includes("naver")) {
    return { ...target, business: "검색과 플랫폼", jokeSeed: "검색창, 자동완성, 초록색 사전" };
  }
  if (name.includes("카카오")) {
    return { ...target, business: "메신저와 플랫폼", jokeSeed: "단톡방, 노란 말풍선, 초콜릿이 아님" };
  }
  return {
    ...target,
    business: target.business ?? "시총 상위 기업",
    jokeSeed: target.jokeSeed ?? `${target.name}이라는 이름 자체`
  };
}

function decodeKoreanHtml(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("euc-kr").decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function parseMarketNumber(value: string | undefined): number {
  if (!value) {
    return NaN;
  }
  return Number(value.replace(/,/g, ""));
}

function fetchWithTimeout(input: string | URL | Request, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

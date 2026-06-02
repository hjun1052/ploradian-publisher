import { fetchTextWithRetry } from "./http";
import type { SourceItem } from "./types";

const KOREA_MARKET_HOUR = 16;
const US_MARKET_HOUR = 7;

interface MarketQuoteTarget {
  name: string;
  symbol: string;
}

interface MarketQuote {
  name: string;
  symbol: string;
  price: number;
  changePercent: number;
}

const KOREA_TARGETS: MarketQuoteTarget[] = [
  { name: "삼성전자", symbol: "005930" },
  { name: "SK하이닉스", symbol: "000660" },
  { name: "네이버", symbol: "035420" },
  { name: "카카오", symbol: "035720" },
  { name: "현대차", symbol: "005380" },
  { name: "LG에너지솔루션", symbol: "373220" },
  { name: "셀트리온", symbol: "068270" },
  { name: "카카오뱅크", symbol: "323410" }
];

const US_TARGETS: MarketQuoteTarget[] = [
  { name: "S&P 500", symbol: "^spx" },
  { name: "나스닥", symbol: "^ndq" },
  { name: "다우", symbol: "^dji" },
  { name: "엔비디아", symbol: "nvda.us" },
  { name: "애플", symbol: "aapl.us" },
  { name: "마이크로소프트", symbol: "msft.us" },
  { name: "테슬라", symbol: "tsla.us" },
  { name: "메타", symbol: "meta.us" },
  { name: "알파벳", symbol: "googl.us" },
  { name: "아마존", symbol: "amzn.us" }
];

export async function scheduledMarketCandidate(now: Date, timeZone: string): Promise<SourceItem | null> {
  const slot = zonedSlot(now, timeZone);

  if (slot.hour === KOREA_MARKET_HOUR) {
    const quotes = await fetchKoreaQuotes(KOREA_TARGETS);
    return marketCandidate("국장", slot, quotes);
  }

  if (slot.hour === US_MARKET_HOUR) {
    const quotes = await fetchUsQuotes(US_TARGETS);
    return marketCandidate("미장", slot, quotes);
  }

  return null;
}

async function fetchKoreaQuotes(targets: MarketQuoteTarget[]): Promise<MarketQuote[]> {
  const settled = await Promise.allSettled(targets.map(fetchNaverQuote));
  return settled.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []));
}

async function fetchNaverQuote(target: MarketQuoteTarget): Promise<MarketQuote | null> {
  const url = new URL("https://polling.finance.naver.com/api/realtime");
  url.searchParams.set("query", `SERVICE_ITEM:${target.symbol}`);
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

  const data = JSON.parse(text) as NaverRealtimeResponse;
  const quote = data.result?.areas?.flatMap((area) => area.datas ?? [])[0];
  if (!quote || typeof quote.nv !== "number" || typeof quote.cr !== "number") {
    return null;
  }

  return {
    name: target.name,
    symbol: target.symbol,
    price: quote.nv,
    changePercent: quote.cr
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
    changePercent: ((close - open) / open) * 100
  };
}

function marketCandidate(market: "국장" | "미장", slot: { day: string; hour: number; offset: string }, quotes: MarketQuote[]): SourceItem | null {
  const usable = quotes.filter((quote) => Number.isFinite(quote.changePercent)).slice(0, 10);
  if (usable.length < 3) {
    return null;
  }

  const slotId = `${slot.day}-${market}-${String(slot.hour).padStart(2, "0")}`;
  const url = `https://news.ploradian.com/market/${slotId}/`;
  const lines = usable.map(
    (quote) => `- ${quote.name} (${quote.symbol}): ${formatPrice(quote.price)}, ${formatChange(quote.changePercent)}`
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

interface NaverRealtimeResponse {
  result?: {
    areas?: Array<{
      datas?: Array<{
        nv?: number;
        cr?: number;
      }>;
    }>;
  };
}

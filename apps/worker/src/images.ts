import { fetchTextWithRetry } from "./http";
import type { ArticleImage, FactSummary, GeneratedArticleJson, RuntimeConfig, SourceItem } from "./types";

const UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos";
const UTM = "?utm_source=the_ploradian&utm_medium=referral";

const CATEGORY_QUERIES: Record<string, string> = {
  "기술": "technology hardware workspace",
  "비즈니스": "business documents workspace",
  "시장": "stock exchange trading screen",
  "헛소리": "empty office desk"
};

const BLOCKED_QUERY_TERMS = [
  "logo",
  "brand",
  "person",
  "people",
  "portrait",
  "face",
  "celebrity",
  "politician"
];

const GENERIC_ARCHITECTURE_TERMS = [
  "architecture",
  "architectural",
  "building",
  "glass building",
  "blue glass",
  "facade",
  "skyscraper"
];

export async function findArticleImage(
  config: RuntimeConfig,
  source: SourceItem,
  article: GeneratedArticleJson,
  facts: FactSummary
): Promise<ArticleImage | null> {
  if (!config.unsplashAccessKey) {
    return null;
  }

  const query = imageQuery(source, article, facts);
  if (!query) {
    return null;
  }

  try {
    const url = new URL(UNSPLASH_SEARCH_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("orientation", "landscape");
    url.searchParams.set("per_page", "10");
    url.searchParams.set("content_filter", "high");

    const { response, text } = await fetchTextWithRetry(
      url,
      {
        headers: {
          authorization: `Client-ID ${config.unsplashAccessKey}`,
          accept: "application/json"
        }
      },
      {
        label: "Unsplash image search",
        timeoutMs: 5000,
        maxBytes: 262144,
        retries: 0
      }
    );

    if (!response.ok) {
      console.warn(JSON.stringify({ event: "unsplash_image_skipped", status: response.status }));
      return null;
    }

    const photo = selectUsablePhoto(parseJson<UnsplashSearchResponse>(text), imageSeed(source));
    if (!photo) {
      return null;
    }

    const photoUrl = photo.urls.raw || photo.urls.regular || photo.urls.full;
    if (!photoUrl) {
      return null;
    }

    return {
      url: sizedImageUrl(photoUrl),
      alt: photo.alt_description || photo.description || `Unsplash image for ${article.category} satire`,
      creditName: photo.user.name || photo.user.username,
      creditUrl: appendUtm(photo.user.links.html)
    };
  } catch (error) {
    console.warn(JSON.stringify({ event: "unsplash_image_skipped", error: errorMessage(error) }));
    return null;
  }
}

function imageQuery(source: SourceItem, article: GeneratedArticleJson, facts: FactSummary): string {
  if (article.category === "헛소리" || source.category === "헛소리") {
    return CATEGORY_QUERIES["헛소리"] ?? "empty office desk";
  }

  const topic = topicImageQuery(source, article, facts);
  if (topic) {
    return topic;
  }

  const base = CATEGORY_QUERIES[article.category] ?? CATEGORY_QUERIES[source.category] ?? "newspaper desk";
  const entities = facts.entities
    .filter((entity) => !looksRisky(entity) && !looksLikeSourceName(entity, source))
    .slice(0, 2)
    .join(" ");

  return [entities, base].filter(Boolean).join(" ").trim();
}

function topicImageQuery(source: SourceItem, article: GeneratedArticleJson, facts: FactSummary): string | null {
  const text = `${source.title} ${source.summary} ${article.title} ${article.subtitle} ${facts.facts.join(" ")}`.toLowerCase();

  if (/(vaccine|백신|doctor|medical|medicine|health|과학적|의사|덴마크)/i.test(text)) {
    return "vaccine laboratory research";
  }

  if (/(hack|hacker|hijack|backdoor|security|cyber|npm|계정 탈취|해커|보안)/i.test(text)) {
    return "cybersecurity code laptop";
  }

  if (/(ai|chatbot|agent|openai|gemini|copilot|artificial intelligence|챗봇|인공지능)/i.test(text)) {
    return "artificial intelligence server lights";
  }

  if (/(chip|gpu|rtx|laptop|hardware|surface|processor|semiconductor|반도체|노트북|칩)/i.test(text)) {
    return "computer hardware circuit board";
  }

  if (/(stock|market|finance|kospi|nasdaq|주가|증시|시장|금융|환율|채권)/i.test(text)) {
    return "stock exchange trading screen";
  }

  if (/(car|gm|vehicle|automotive|자동차|차량)/i.test(text)) {
    return "automotive engineering workshop";
  }

  if (/(conference|keynote|developer|build|wwdc|개발자|콘퍼런스)/i.test(text)) {
    return "developer conference stage";
  }

  return null;
}

function selectUsablePhoto(data: UnsplashSearchResponse, seed: number): UnsplashPhoto | null {
  const photos = Array.isArray(data.results) ? data.results : [];
  const usable = photos.filter((photo) => {
    const alt = `${photo.alt_description ?? ""} ${photo.description ?? ""}`.toLowerCase();
    return (
      photo.urls &&
      photo.user?.links?.html &&
      !BLOCKED_QUERY_TERMS.some((term) => alt.includes(term)) &&
      !GENERIC_ARCHITECTURE_TERMS.some((term) => alt.includes(term))
    );
  });

  if (usable.length === 0) {
    return null;
  }

  return usable[seed % usable.length] ?? null;
}

function sizedImageUrl(raw: string): string {
  const url = new URL(raw);
  url.searchParams.set("w", "1400");
  url.searchParams.set("q", "80");
  url.searchParams.set("auto", "format");
  url.searchParams.set("fit", "crop");
  return url.toString();
}

function appendUtm(raw: string): string {
  const separator = raw.includes("?") ? "&" : "?";
  return `${raw}${separator}${UTM.slice(1)}`;
}

function looksRisky(value: string): boolean {
  const normalized = value.toLowerCase();
  return BLOCKED_QUERY_TERMS.some((term) => normalized.includes(term)) || normalized.length > 36;
}

function looksLikeSourceName(value: string, source: SourceItem): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === source.feedName.toLowerCase() ||
    normalized.includes("ars technica") ||
    normalized.includes("the verge") ||
    normalized.includes("npr") ||
    normalized.includes("연합인포맥스") ||
    normalized.includes("ploradian")
  );
}

function imageSeed(source: SourceItem): number {
  const value = source.canonicalUrl || source.url || source.title;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface UnsplashSearchResponse {
  results?: UnsplashPhoto[];
}

interface UnsplashPhoto {
  description?: string | null;
  alt_description?: string | null;
  urls: {
    raw?: string;
    full?: string;
    regular?: string;
  };
  user: {
    name: string;
    username: string;
    links: {
      html: string;
    };
  };
}

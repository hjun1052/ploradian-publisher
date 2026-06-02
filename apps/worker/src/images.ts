import { fetchTextWithRetry } from "./http";
import type { ArticleImage, FactSummary, GeneratedArticleJson, RuntimeConfig, SourceItem } from "./types";

const UNSPLASH_SEARCH_URL = "https://api.unsplash.com/search/photos";
const UTM = "?utm_source=the_ploradian&utm_medium=referral";

const CATEGORY_QUERIES: Record<string, string> = {
  "기술": "abstract technology office",
  "비즈니스": "business office meeting",
  "시장": "stock market finance",
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
    url.searchParams.set("per_page", "8");
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
        maxBytes: 65536,
        retries: 0
      }
    );

    if (!response.ok) {
      console.warn(JSON.stringify({ event: "unsplash_image_skipped", status: response.status }));
      return null;
    }

    const photo = firstUsablePhoto(parseJson<UnsplashSearchResponse>(text));
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

  const base = CATEGORY_QUERIES[article.category] ?? CATEGORY_QUERIES[source.category] ?? "newspaper office";
  const entities = facts.entities
    .filter((entity) => !looksRisky(entity))
    .slice(0, 1)
    .join(" ");

  return [entities, base].filter(Boolean).join(" ").trim();
}

function firstUsablePhoto(data: UnsplashSearchResponse): UnsplashPhoto | null {
  const photos = Array.isArray(data.results) ? data.results : [];
  return photos.find((photo) => {
    const alt = `${photo.alt_description ?? ""} ${photo.description ?? ""}`.toLowerCase();
    return photo.urls && photo.user?.links?.html && !BLOCKED_QUERY_TERMS.some((term) => alt.includes(term));
  }) ?? null;
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

import type { GeneratedArticleJson, PreparedArticle, RuntimeConfig, SourceItem } from "./types";

export function prepareMarkdownArticle(
  generated: GeneratedArticleJson,
  source: SourceItem,
  sourceHash: string,
  config: RuntimeConfig,
  now = new Date()
): PreparedArticle {
  const date = formatZonedIso(now, config.siteTimezone);
  const day = date.slice(0, 10);
  const topic = topicSlug(generated.slug || generated.title || source.title, source.category, sourceHash);
  const slug = `${day}-${sourceHash.slice(0, 8)}-${topic}`;
  const path = `content/articles/published/${slug}.md`;
  const category = normalizeCategory(generated.category || source.category);

  const article: Omit<PreparedArticle, "markdown" | "path" | "sourceHash" | "topic"> = {
    title: generated.title.trim(),
    subtitle: generated.subtitle.trim(),
    slug,
    date,
    category,
    source_name: source.feedName,
    source_url: source.url,
    original_title: source.title,
    generated_by: config.generationModel,
    status: "published",
    body: generated.body.trim()
  };

  const markdown = renderMarkdown(article);

  return {
    ...article,
    path,
    markdown,
    sourceHash,
    topic
  };
}

function renderMarkdown(article: Omit<PreparedArticle, "markdown" | "path" | "sourceHash" | "topic">): string {
  return `---\ntitle: ${yamlString(article.title)}\nsubtitle: ${yamlString(article.subtitle)}\nslug: ${yamlString(article.slug)}\ndate: ${yamlString(article.date)}\ncategory: ${yamlString(article.category)}\nsource_name: ${yamlString(article.source_name)}\nsource_url: ${yamlString(article.source_url)}\noriginal_title: ${yamlString(article.original_title)}\ngenerated_by: ${yamlString(article.generated_by)}\nstatus: ${yamlString(article.status)}\n---\n\n${article.body}\n`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function normalizeCategory(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("ko-KR");

  if (["technology", "tech", "it", "ai", "기술"].includes(normalized)) {
    return "기술";
  }

  if (["business", "biz", "economy", "비즈니스", "경제"].includes(normalized)) {
    return "비즈니스";
  }

  if (["markets", "market", "finance", "financial", "금융", "시장", "증시"].includes(normalized)) {
    return "시장";
  }

  if (["nonsense", "bullshit", "bs", "absurd", "anti-news", "antinote", "헛소리", "개소리", "뻘소리"].includes(normalized)) {
    return "헛소리";
  }

  return value.trim();
}

function topicSlug(value: string, category: string, hash: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7)
    .join("-");

  const fallback = category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return (ascii || fallback || `story-${hash.slice(0, 6)}`).slice(0, 72).replace(/-$/g, "");
}

function formatZonedIso(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((localAsUtc - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offsetHour = String(Math.floor(absolute / 60)).padStart(2, "0");
  const offsetMinute = String(absolute % 60).padStart(2, "0");

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${sign}${offsetHour}:${offsetMinute}`;
}

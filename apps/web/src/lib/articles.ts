import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

export interface ArticleFrontmatter {
  title: string;
  subtitle: string;
  slug: string;
  date: string;
  category: string;
  source_name: string;
  source_url: string;
  original_title: string;
  generated_by: string;
  status: "published";
}

export interface Article extends ArticleFrontmatter {
  body: string;
  html: string;
  excerpt: string;
  readingMinutes: number;
  filePath: string;
}

const articlesDir = path.resolve(process.cwd(), "../../content/articles/published");

marked.use({
  gfm: true,
  breaks: false
});

export async function getPublishedArticles(): Promise<Article[]> {
  if (!existsSync(articlesDir)) {
    return [];
  }

  const filenames = (await readdir(articlesDir))
    .filter((name) => name.endsWith(".md"))
    .sort();

  const articles = await Promise.all(
    filenames.map(async (filename) => parseArticle(path.join(articlesDir, filename)))
  );

  return articles
    .filter((article): article is Article => article !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const articles = await getPublishedArticles();
  return articles.find((article) => article.slug === slug) ?? null;
}

export function formatDisplayDate(date: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(date));
}

export function formatIssueDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul"
  }).format(date);
}

async function parseArticle(filePath: string): Promise<Article | null> {
  const raw = await readFile(filePath, "utf8");
  const parsed = matter(raw);
  const data = parsed.data as Partial<ArticleFrontmatter>;

  if (data.status !== "published") {
    return null;
  }

  const frontmatter = normalizeFrontmatter(data, filePath);
  const body = parsed.content.trim();
  const html = marked.parse(body, { async: false }) as string;

  return {
    ...frontmatter,
    body,
    html,
    excerpt: makeExcerpt(body),
    readingMinutes: Math.max(1, Math.ceil(body.length / 650)),
    filePath
  };
}

function normalizeFrontmatter(
  data: Partial<ArticleFrontmatter>,
  filePath: string
): ArticleFrontmatter {
  const required: Array<keyof ArticleFrontmatter> = [
    "title",
    "subtitle",
    "slug",
    "date",
    "category",
    "source_name",
    "source_url",
    "original_title",
    "generated_by",
    "status"
  ];

  for (const key of required) {
    if (typeof data[key] !== "string" || data[key]?.trim() === "") {
      throw new Error(`Missing article frontmatter "${key}" in ${filePath}`);
    }
  }

  return data as ArticleFrontmatter;
}

function makeExcerpt(body: string): string {
  const plain = body.replace(/\s+/g, " ").trim();
  if (plain.length <= 150) {
    return plain;
  }
  return `${plain.slice(0, 148).trim()}...`;
}

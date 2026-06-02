import type { APIContext } from "astro";
import { getPublishedArticles } from "../lib/articles";

const PUBLICATION_NAME = "The Ploradian";
const PUBLICATION_LANGUAGE = "ko";
const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function GET(context: APIContext) {
  const site = context.site?.toString().replace(/\/$/, "") ?? "https://news.ploradian.com";
  const cutoff = Date.now() - NEWS_WINDOW_MS;
  const articles = (await getPublishedArticles()).filter(
    (article) => new Date(article.date).getTime() >= cutoff
  );

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${articles
    .map((article) => {
      const loc = `${site}/article/${article.slug}/`;
      const date = new Date(article.date).toISOString();

      return [
        "  <url>",
        `    <loc>${escapeXml(loc)}</loc>`,
        `    <lastmod>${date}</lastmod>`,
        "    <news:news>",
        "      <news:publication>",
        `        <news:name>${escapeXml(PUBLICATION_NAME)}</news:name>`,
        `        <news:language>${PUBLICATION_LANGUAGE}</news:language>`,
        "      </news:publication>",
        `      <news:publication_date>${date}</news:publication_date>`,
        `      <news:title>${escapeXml(article.title)}</news:title>`,
        "    </news:news>",
        "  </url>"
      ].join("\n");
    })
    .join("\n")}\n</urlset>`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8"
    }
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

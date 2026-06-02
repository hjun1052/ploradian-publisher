import type { APIContext } from "astro";
import { getPublishedArticles } from "../lib/articles";

export async function GET(context: APIContext) {
  const site = context.site?.toString().replace(/\/$/, "") ?? "https://news.ploradian.com";
  const articles = await getPublishedArticles();
  const urls = [
    { loc: `${site}/`, lastmod: latestDate(articles) },
    { loc: `${site}/archive/`, lastmod: latestDate(articles) },
    { loc: `${site}/about/`, lastmod: latestDate(articles) },
    ...articles.map((article) => ({
      loc: `${site}/article/${article.slug}/`,
      lastmod: new Date(article.date).toISOString()
    }))
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) =>
        `  <url><loc>${escapeXml(url.loc)}</loc><lastmod>${url.lastmod}</lastmod></url>`
    )
    .join("\n")}\n</urlset>`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8"
    }
  });
}

function latestDate(articles: Array<{ date: string }>): string {
  return articles[0] ? new Date(articles[0].date).toISOString() : new Date().toISOString();
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

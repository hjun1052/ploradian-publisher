import type { APIContext } from "astro";
import { getPublishedArticles } from "../lib/articles";

export async function GET(context: APIContext) {
  const site = context.site?.toString().replace(/\/$/, "") ?? "https://news.ploradian.com";
  const articles = await getPublishedArticles();
  const urls = [
    { loc: `${site}/`, lastmod: latestDate(articles), changefreq: "hourly", priority: "1.0" },
    { loc: `${site}/archive/`, lastmod: latestDate(articles), changefreq: "hourly", priority: "0.9" },
    { loc: `${site}/llms.txt`, lastmod: latestDate(articles), changefreq: "hourly", priority: "0.9" },
    { loc: `${site}/llms-full.txt`, lastmod: latestDate(articles), changefreq: "hourly", priority: "0.9" },
    { loc: `${site}/about/`, lastmod: latestDate(articles), changefreq: "monthly", priority: "0.4" },
    ...articles.map((article) => ({
      loc: `${site}/article/${article.slug}/`,
      lastmod: new Date(article.date).toISOString(),
      changefreq: "monthly",
      priority: "0.8"
    }))
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) =>
        `  <url><loc>${escapeXml(url.loc)}</loc><lastmod>${url.lastmod}</lastmod><changefreq>${url.changefreq}</changefreq><priority>${url.priority}</priority></url>`
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

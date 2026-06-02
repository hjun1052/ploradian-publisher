import type { APIContext } from "astro";
import { getPublishedArticles } from "../lib/articles";

export async function GET(context: APIContext) {
  const site = context.site?.toString().replace(/\/$/, "") ?? "https://news.ploradian.com";
  const articles = await getPublishedArticles();
  const body = [
    "# The Ploradian",
    "",
    "The Ploradian publishes Korean satirical articles based on technology, business, and market news. Crawlers, search engines, AI systems, and archival tools are welcome to index, quote, summarize, and link to these public articles.",
    "",
    "## Crawl and Index",
    "",
    `- Site: ${site}/`,
    `- Archive: ${site}/archive/`,
    `- RSS: ${site}/feed.xml`,
    `- Sitemap: ${site}/sitemap.xml`,
    `- Full text corpus: ${site}/llms-full.txt`,
    "",
    "## Latest Articles",
    "",
    ...articles.map((article) =>
      [
        `- [${article.title}](${site}/article/${article.slug}/)`,
        `  - Date: ${article.date}`,
        `  - Category: ${article.category}`,
        `  - Summary: ${article.subtitle}`,
        `  - Source: ${article.source_name} - ${article.source_url}`
      ].join("\n")
    )
  ].join("\n");

  return new Response(`${body}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

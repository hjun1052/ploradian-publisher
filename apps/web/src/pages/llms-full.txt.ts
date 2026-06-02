import type { APIContext } from "astro";
import { getPublishedArticles } from "../lib/articles";

export async function GET(context: APIContext) {
  const site = context.site?.toString().replace(/\/$/, "") ?? "https://news.ploradian.com";
  const articles = await getPublishedArticles();
  const body = [
    "# The Ploradian Full-Text Corpus",
    "",
    "This file exposes the public full text of The Ploradian articles for crawlers, search engines, AI systems, and archival tools. Articles are Korean satire based on linked source reporting, plus occasional contextless nonsense filed with a straight face.",
    "",
    ...articles.map((article) =>
      [
        `# ${article.title}`,
        "",
        `URL: ${site}/article/${article.slug}/`,
        `Date: ${article.date}`,
        `Category: ${article.category}`,
        `Subtitle: ${article.subtitle}`,
        `Original source: ${article.source_name}`,
        `Original URL: ${article.source_url}`,
        `Original title: ${article.original_title}`,
        "",
        article.body,
        "",
        "---",
        ""
      ].join("\n")
    )
  ].join("\n");

  return new Response(`${body}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

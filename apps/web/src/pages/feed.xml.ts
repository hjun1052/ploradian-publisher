import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getPublishedArticles } from "../lib/articles";

export async function GET(context: APIContext) {
  const articles = await getPublishedArticles();
  const site = context.site?.toString() ?? "https://news.ploradian.com/";

  return rss({
    title: "The Ploradian",
    description: "한국어 기술, 비즈니스, 시장, 헛소리 풍자 기사.",
    site,
    customData: "<language>ko-KR</language>",
    items: articles.map((article) => ({
      title: article.title,
      description: article.subtitle,
      pubDate: new Date(article.date),
      link: `/article/${article.slug}/`,
      categories: [article.category],
      customData: `<source>${escapeXml(article.source_name)}</source>`
    }))
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

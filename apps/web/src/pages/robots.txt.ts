import type { APIContext } from "astro";

export function GET(context: APIContext) {
  const site = context.site?.toString().replace(/\/$/, "") ?? "https://news.ploradian.com";
  const openAgents = [
    "GPTBot",
    "ChatGPT-User",
    "OAI-SearchBot",
    "ClaudeBot",
    "Claude-SearchBot",
    "anthropic-ai",
    "PerplexityBot",
    "Google-Extended",
    "Applebot",
    "Applebot-Extended",
    "CCBot",
    "Meta-ExternalAgent",
    "Amazonbot",
    "YouBot",
    "Bytespider"
  ];
  const body = `${openAgents.map((agent) => `User-agent: ${agent}\nAllow: /`).join("\n\n")}

User-agent: *
Allow: /

# Public text indexes for AI, search, and archival crawlers:
# ${site}/classic/
# ${site}/llms.txt
# ${site}/llms-full.txt

Sitemap: ${site}/sitemap.xml
Sitemap: ${site}/news-sitemap.xml
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

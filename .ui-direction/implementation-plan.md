## Implementation Plan

Selected hero composition: No marketing hero. Use a newspaper front page: masthead, issue line, lead article, secondary list, and briefs.

Rejected hero options:
- Split hero with mockup image: too SaaS-like.
- Full-bleed generated newsroom image: risks fake editorial claims.
- Joke splash page: violates serious-publication requirement.

Section choreography:
- Header masthead and issue metadata.
- Homepage front-page grid with lead, secondary stories, and latest briefs.
- Archive page with a compact search desk and list-first browsing mode.
- Article detail page with title deck, source attribution, prose, and disclaimer.
- About page explaining the satirical publication plainly.
- Footer disclaimer and feed links.

Component mapping:
- Header/navigation: `SiteHeader`.
- Homepage story modules: `ArticleCard`.
- Archive/search: static article data plus small progressive-enhancement script.
- Article body shell: `BaseLayout` plus page-specific prose.
- RSS/sitemap: static Astro endpoints.

Validation plan:
- Install dependencies.
- Build Astro static output.
- Typecheck Worker after generating Wrangler types.
- Run Worker TypeScript checks.
- Smoke-test homepage/article/about/feed/sitemap locally.
- Smoke-test archive search by Korean title, source/category filters, empty state, and mobile stacking.

Screenshot pass plan:
- Start Astro dev server.
- Inspect desktop and mobile screenshots.
- Tighten spacing/type if the first viewport feels like a generic blog.

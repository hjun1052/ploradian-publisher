## 2013 Implementation Plan

1. Create `Ploradian2013Layout.astro` with SEO metadata, RSS links, app-bar navigation, and isolated CSS.
2. Add `/2013/` home:
   - hero from highest-ranked home article
   - compact secondary story rail
   - article card grid
   - static weather note as a small 2013-style module
3. Add `/2013/article/[slug]/`:
   - canonical points to the normal article to avoid duplicate SEO
   - alternate points to the 2013 page
   - real image panel with credit
   - article body, source, single heart button, related/latest links
4. Add navigation and sitemap/robots discoverability:
   - global header link to `/2013/`
   - sitemap entries for `/2013/` and 2013 article URLs
   - robots text mention for the alternate edition
5. Validate with web typecheck, build, and static HTML checks.

## Component Inventory

Existing components to reuse: None; repo starts empty.

New components/classes needed:
- `BaseLayout.astro`: document shell, metadata, global chrome.
- `SiteHeader.astro`: masthead, date line, compact nav.
- `ArticleCard.astro`: lead, standard, and brief variants.
- Global CSS utilities for editorial grids, rules, metadata, and article prose.

Component variants:
- Lead card: large headline, subtitle, source metadata.
- Standard card: medium headline and short subtitle.
- Brief card: category, title, compact date.

Interaction states:
- Links use underline and accent color on hover/focus.
- Focus-visible outlines are explicit and high contrast.

Responsive behavior:
- Desktop: lead + secondary column + briefs.
- Tablet: two-column story list.
- Mobile: single flow with stable vertical rhythm.

Accessibility notes:
- Semantic header/nav/main/footer.
- Article cards expose clear link targets.
- Dates use machine-readable `datetime`.

Files where components live:
- `apps/web/src/layouts/BaseLayout.astro`
- `apps/web/src/components/SiteHeader.astro`
- `apps/web/src/components/ArticleCard.astro`
- `apps/web/src/styles/global.css`

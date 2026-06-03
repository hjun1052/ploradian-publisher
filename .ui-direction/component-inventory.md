## Component Inventory

### Reuse

- Article data helpers: `getPublishedArticles`, `formatDisplayDate`.
- Home ranking helper: `getHomeFeaturedArticles`.
- Existing `/api/reactions` endpoint for the article heart.
- Existing source/image frontmatter fields.

### New

- `Ploradian2013Layout.astro`: standalone head, app bar, footer, 2013 CSS import.
- `/2013/index.astro`: 2013 edition home.
- `/2013/article/[slug]/index.astro`: 2013 article reader.
- `ploradian2013.css`: edition-specific tokens and visual system.

### States

- Image present: blurred hero/photo cards.
- Image missing: pastel panel placeholder.
- Heart unloaded: count starts at 0 and lazy-loads when visible.
- Heart pressed: `aria-pressed="true"` and filled accent styling.

### Unchanged

- Default home/article styling.
- Classic no-JS/no-CSS-ish styling.

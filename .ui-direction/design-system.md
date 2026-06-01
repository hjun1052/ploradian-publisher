## Palette Research

### Direction A: Warm Broadsheet
Mood: Paper, ink, business desk.
Domain fit: Strong for satire that must look like a real serious paper.
Tokens: paper, paper-muted, ink, ink-soft, rule, accent-burgundy.
Usage ratio: 78% paper, 17% ink/rules, 5% accent.
Risks: Too beige if accent and rules are weak.
Why refined: Matches newspaper heritage without copying a single brand.
Cheapness risk: Heavy texture or sepia nostalgia.

### Direction B: Terminal Ledger
Mood: Technical finance terminal softened for reading.
Domain fit: Good for economy/IT, weaker for newspaper identity.
Tokens: chalk, graphite, blue-gray, electric accent.
Usage ratio: 72% neutral, 22% text/rules, 6% accent.
Risks: Could drift into SaaS dashboard.
Why refined: Precise and data-like.
Cheapness risk: Looks like a product analytics app.

### Direction C: Institutional White
Mood: Legacy newspaper website, clear and dry.
Domain fit: Usable and familiar.
Tokens: white, black, gray rules, muted red.
Usage ratio: 84% white, 13% ink/rules, 3% accent.
Risks: Too generic without strong typography.
Why refined: High contrast and minimal.
Cheapness risk: Default blog if spacing is not disciplined.

Selected palette: Direction A, with low-saturation burgundy as the only accent.

Rejected colors: Loud red, saturated blue, novelty yellow, gradients, dark mode.

Palette lock:
- `--color-paper: #f7f1e6`
- `--color-paper-muted: #efe5d4`
- `--color-surface: #fffaf0`
- `--color-ink: #171513`
- `--color-ink-soft: #59524a`
- `--color-rule: #cfc2ad`
- `--color-rule-strong: #8d7f6c`
- `--color-accent: #7c1f2c`
- `--color-accent-soft: #efe0df`

Typography:
- Latin headlines: Newsreader via `@fontsource/newsreader`.
- Korean headlines/body: Noto Serif KR via `@fontsource/noto-serif-kr`.
- Metadata/UI: Inter plus Noto Sans KR via `@fontsource/inter` and `@fontsource/noto-sans-kr`.

Spacing scale: 4, 8, 12, 16, 24, 32, 48, 72.

Material system: Flat paper fields, hairline rules, no shadows except focus rings.

Depth hierarchy: Type scale and borders only; no floating cards inside cards.

Motion system: Minimal link underline transitions only.

Content budget: Homepage first viewport should show masthead, lead story, and at least two secondary headlines on desktop.

Responsive rules: Collapse columns to one flow under 760px; keep masthead legible and date line compact.

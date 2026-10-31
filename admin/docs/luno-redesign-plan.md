# Admin redesign — Luno look (plan)

Reference: https://wrraptheme.com/templates/luno/index.html (inspected 22 Oct 2026 over CDP).
Goal: the site admin (`admin/`, Next 16 + Tailwind 4 + shadcn/base-ui, 87 pages) gets Luno's look and motion,
while every page keeps its content, data, API calls and behaviour exactly as today.

## Ground rules

- **Look only.** Change `className`, design tokens, layout wrappers and animation. Never change props, API calls,
  hooks, state, permissions (`<Can>`), validation, labels or `aria-*`.
- **Pixel-same, legally.** Luno is a paid ThemeForest template, so its own CSS files and images are not copied.
  Everything else is taken from the same free sources Luno itself uses, so the result is the same to the inch:
  - **Font:** Nunito (Google Fonts, OFL) — Luno's body font; Open Sans / Quicksand / Raleway where Luno uses them.
  - **Icons:** Luno builds its icons from free libraries — Bootstrap Icons (MIT, the 16×16 sidebar / card icons),
    Font Awesome 4 (`fa fa-*`), Line Awesome (`la`), simple-line-icons, Weather Icons. We use the same
    libraries (npm packages, not files from Luno). Luno's two-tone look (one path filled with the secondary
    colour) is redrawn by our own icon skill (see step 1b).
  - **Charts:** ApexCharts (MIT) through `react-apexcharts`, with Luno's options (colours, rounded bars,
    stacked columns, donut with "Total" in the middle, legend below, soft grid) — same charts, not a lookalike.
  - **Motion:** Luno's own timings and easings measured from the page (sidebar submenu collapse, dropdown
    "morphing scale-left", side-drawer / vertical modal slide, fade) and rebuilt in Tailwind keyframes.
  - **Look:** colours, sizes, spacing, radius, borders, shadows measured with CDP into `luno-spec.json`.
- **Each page is proved unchanged in behaviour**: an audit before and after (same controls, same labels, same
  network calls, no new console error, no NaN / undefined / Invalid Date).
- **Defaults (until the owner says otherwise):** light theme by default with a dark toggle (as Luno); Luno's
  blue / teal palette; the sidebar's "Select Project" slot shows the site logo + name, and its bottom icon row
  holds real shortcuts (Deposits, Withdrawals, KYC, Users) — nothing fake.

## What Luno looks like (measured)

| Part | Luno |
|---|---|
| Font | Nunito, 16px base, text `#363535` |
| Page background | `#f4f7f6` (theme-blue body) |
| Card | white, radius 12px, **1px dashed** border `#e9e6e1`, no shadow; header padding 24px |
| Primary / accent | blue `#2794eb` (buttons, badges), teal `#00ac9a` (active menu item) |
| Badge | radius 6px, 12px bold, padding 4px 8px |
| Sidebar | 280px, same bg as page, padding 16px 8px; header "LUNO Admin" + menu button; project select + "+" button; menu groups with a TITLE and a small subtitle (MAIN / "Unique dashboard designs"); open submenu drawn with a thin vertical line; active item teal; bottom row of 4 icons |
| Header | 74px, sticky, padding 8px 24px: hamburger, logo, wide search, icons (notification, fullscreen, language, apps, theme, avatar, settings) |
| Page toolbar | breadcrumb (Home / Page, teal link), title "Welcome back…" + muted subtitle; right: date-range input + grouped icon buttons |
| Stat card | CAPS title + icon top-right, big number + ↑ % (muted), "Analytics for last week", coloured progress bar along the bottom edge |
| Chart card | title left, expand + "…" round buttons right; ApexCharts style (soft grid, rounded bars, legend below) |
| Highlight card | blue→teal gradient, centred white text, outlined white CTA |
| Modals | mostly vertical, slide in from the side (`modal-dialog-vertical`, right-side settings) |
| Themes | `data-luno="theme-blue|indigo|black|…"` swaps primary/secondary + chart colours; dark mode toggle |

## Steps

### 1. Skill — `.claude/skills/admin-luno-redesign/`
- `SKILL.md`: the ground rules above, the token map (Luno value → our CSS variable), the component map (Luno
  pattern → our shadcn/shared component), animation rules, the per-page checklist, and a do-not-touch list.
- `extract-luno.mjs` (CDP): opens Luno pages and writes `luno-spec.json` (computed colours, fonts, sizes,
  spacing, radius, borders, shadows of sidebar, header, toolbar, card, stat card, table, badge, button, input,
  select, tabs, modal, dropdown, pagination, toast) plus screenshots of ~8 reference pages: dashboard, a table
  page, a form page, a modal, tabs, a profile, login, dark mode.
- `page-audit.mjs` (CDP, one admin page): screenshot at 360 / 768 / 1280 and in light + dark; inventory of
  buttons / inputs / tabs / links with their labels; the page's API calls; console errors; NaN / undefined.
  Writes JSON; `--diff before.json after.json` lists anything that disappeared or changed.
- `pages.txt`: the 87 admin routes in working order.

### 1b. Icon skill — `.claude/skills/luno-icons/` (built first, used by every later step)
- `SKILL.md`: how an admin icon is made — the base glyph from Bootstrap Icons / Font Awesome 4 / Line Awesome
  (installed packages), the Luno two-tone rule (which path gets the secondary colour), size 16 / 20 / 24,
  `currentColor` + `--secondary-color` so dark mode and theme colours work.
- `icon-inventory.mjs` (CDP): lists every icon on the Luno reference pages — library, glyph name, which path
  is two-tone, size, colour — into `luno-icons.json`.
- `make-icon.mjs`: builds a React component (`admin/src/components/icons/<Name>.tsx`) from a library glyph,
  adding the two-tone split; also writes a preview sheet (HTML) to compare against the Luno screenshot.
- `icon-map.md`: each admin menu item / button → its Luno icon.
- Check: preview sheet side by side with Luno; icons render in light + dark; no lucide icon left where Luno
  has one.

### 1c. Motion and charts reference
- `extract-luno.mjs` also records transitions: the CSS `transition` / `animation` of the sidebar submenu,
  dropdowns, side drawers (vertical modals), tooltips and cards, and the drawer's open/close timing
  (screen-recorded frames over CDP).
- ApexCharts options for each Luno chart (bar / stacked bar, donut, area, line, radial) read from the page's
  chart instances into `luno-charts.json`; our chart component takes the same options.

### 2. Extract
- Run `extract-luno.mjs` → `luno-spec.json` + reference screenshots.
- Run `page-audit.mjs` on every admin page → the "before" set (`logs/qa/redesign/before/`).

### 3. Foundation (`admin/src/app/globals.css`, layout, fonts)
- Light and dark tokens from the spec: background, card, border (dashed), muted, primary, accent, sidebar,
  chart-1…5, radius 12px.
- Nunito through `next/font`.
- Theme colour variants (like Luno's theme-blue / indigo / black) — optional switch in the header.
- Motion (Tailwind keyframes, all off under `prefers-reduced-motion`): page enter fade + slide, dropdown
  "morphing" scale, card hover lift, sidebar submenu expand / collapse, side-sheet slide, number count-up on
  stat cards, skeleton shimmer.

### 4. Shell
- Sidebar: site logo + name on top, menu groups with title + subtitle, submenu tree line, teal active item,
  collapse to icons, bottom shortcut row.
- Header: menu toggle, logo, search (existing command palette if any), notification / fullscreen / theme /
  profile.
- Page toolbar: breadcrumb, title + subtitle, right-side actions (date range, export buttons) — fed by the
  existing `PageHeader` props.
- Footer.

### 5. Components
- shadcn (`components/ui`): card, button, badge, input, select, combobox, tabs, table, dialog + sheet (side
  sheet as Luno's vertical modal), dropdown-menu, pagination, sonner toasts, skeleton, switch, checkbox,
  tooltip, progress.
- Shared (`components/shared`): PageHeader, StatCard (bottom progress bar), DataTable, FilterBar, StatusBadge,
  Money, empty / error states.
- Charts: the shared chart components (`components/shared/charts`) move from Recharts to ApexCharts with
  Luno's options; every screen keeps passing the same data (series, labels, formatters) — only the renderer
  changes.

### 6. Pages, one group at a time
Order: Dashboard → Users / user detail / wallets / KYC → Transactions → Finance → Reports → Sports Exchange →
Casino / Original Games → Promotions / Races / VIP / Bonus / Affiliate → Content / Push → Site config →
Settings / Access.
For each page:
1. `page-audit.mjs` before (already in step 2).
2. Restyle (layout wrappers + classNames only).
3. `page-audit.mjs` after and `--diff`: same controls and labels, same API calls, no new console error, no
   NaN / undefined, no side-scroll at 360.
4. Look at the screenshots next to the matching Luno reference.
5. Commit the group; push after the group's checks pass.

### 7. Checks after every group
- `npx tsc --noEmit -p .` and `npx eslint` on changed files.
- Admin crawl (every page and tab renders; no error toasts).
- Click-through on the group: tabs switch, dialogs open and close, forms validate, save buttons enable /
  disable as before (no live writes).
- Light and dark, 360 / 768 / 1280.

## Decisions for the owner
1. Light default with dark toggle (recommended) — or keep dark default.
2. Primary colour: Luno blue / teal (recommended for the sample) — or Parker567 green.
3. Sidebar top / bottom: site logo + real shortcuts (recommended) — or leave them out.

## Not in scope
- Copying Luno's own CSS files or images (licence). Fonts, icon libraries and ApexCharts are the free
  originals Luno also uses, installed from npm / Google Fonts.
- Any change to behaviour, data, permissions or API.
- The owner panel and the player site.

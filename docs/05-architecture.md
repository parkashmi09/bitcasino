# Architecture

## Repository layout

```
BitCasino/
├── apps/
│   ├── web/                        React + Vite + Tailwind front end
│   │   ├── public/                 generated assets (git-tracked)
│   │   │   ├── fonts/              self-hosted woff2
│   │   │   ├── icons/              PNG app icons
│   │   │   ├── images/             games / providers / promos
│   │   │   ├── favicon.svg
│   │   │   └── manifest.webmanifest
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ui/             primitives: Button, Badge, Chip, Icon, Skeleton
│   │   │   │   ├── layout/         Header, Sidebar, Footer, Layout, Logo, ScrollToTop
│   │   │   │   └── sections/       Hero, GameCard, GameRail, ThemeRail,
│   │   │   │                       CategoryStrip, TrustSection, SeoContent,
│   │   │   │                       ProviderRail, PromoGrid, VipBanner,
│   │   │   │                       CryptoFeatures, AccessAnywhere,
│   │   │   │                       GettingStarted, Testimonials
│   │   │   ├── pages/              Home, Category, Providers, Provider, Play, NotFound
│   │   │   ├── data/               types.js, catalog.js (seed content)
│   │   │   ├── hooks/              useTheme, useMediaQuery
│   │   │   ├── lib/                cn, theme, format
│   │   │   ├── styles/             tokens.css, index.css, fonts.css
│   │   │   ├── App.jsx             routes
│   │   │   └── main.jsx            entry
│   │   ├── index.html
│   │   └── vite.config.js
│   └── api/                        Express 5 (plain JS, no build step)
│       └── src/
│           ├── routes/             games.js, catalog.js
│           ├── middleware/         errors.js
│           ├── data/seed.js        server-side seed catalog
│           └── index.js
├── docs/
├── scripts/                        fetch-fonts.mjs, generate-assets.mjs
└── package.json                    npm workspaces root
```

## Layer boundaries

**`components/ui/`** — no app knowledge. Primitives take props, render markup,
and know nothing about games or routing. Reusable in any project.

**`components/sections/`** — knows domain types (`Game`, `Provider`) but not
where data came from. Everything arrives via props.

**`pages/`** — reads from the data layer and composes sections. This is the
only place that decides *what* appears on a screen.

**`data/`** — the seam. Today it exports static arrays; swapping it for
`fetch('/api/...')` calls is the single change needed to go live.

The rule: dependencies point inward — `pages` → `sections` → `ui`, never back.

## Routing

| Path | Page | Notes |
| --- | --- | --- |
| `/` | `Home` | Hero + provider strip + rails + editorial blocks |
| `/categories/:slug` | `Category` | Game list, filtered by provider |
| `/games/:slug` | `Category` | Curated collection (`COLLECTIONS`), same view |
| `/providers` | `Providers` | Studio index |
| `/providers/:slug` | `Provider` | One studio, game list filtered by category |
| `/play/:category/:slug` | `Play` | Game frame placeholder + similar rail |
| `/login` | `Login` | Split screen — **outside `Layout`** |
| `/register` | `SignUp` | Split screen — **outside `Layout`** |
| `/promotions`, `/tournaments`, `/vip` | redirect | Stubs — redirect to `/` |
| `/forgot-password` | redirect | Stub — redirects to `/login` |
| `/terms`, `/privacy` | redirect | Stubs — redirect to `/register` |
| `*` | `NotFound` | |

Every route but the two auth screens renders inside `Layout`, which owns the
header, sidebar, footer, the mobile slide-over and the search dialog.
`ScrollToTop` resets scroll on navigation.

Search is deliberately **not** a route. The reference 404s on `/search` and
runs search as a dialog over the current page, so `SearchDialog` is mounted in
`Layout` and opened from the header rather than navigated to. `/login` and `/register` sit outside it because the reference
drops the whole app shell on both and splits the viewport instead.

Since this is a client-side SPA, **any static host must rewrite unknown paths
to `index.html`** or deep links 404. See [08 — Setup](./08-setup.md).

## State

There is no state library, and none is needed yet:

| State | Where |
| --- | --- |
| Theme | `useTheme` → `localStorage` + `<html>` class |
| Mobile nav open | `useState` in `Layout` |
| Game-list filter | `useState` in `Category` / `Provider` |
| Game-list sort | `useState` in `GameList` |
| Rail scroll affordances | `useState` + `ResizeObserver` in `GameRail` |

Add TanStack Query when the data layer becomes remote — it fits the
`data/` seam without touching components.

## API

Express 5 on `:4000`, proxied at `/api` by the Vite dev server so the browser
sees one origin in development.

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | `{ ok, uptime }` |
| `GET /api/games` | Paged list; `category`, `provider`, `q`, `limit`, `offset` |
| `GET /api/games/:slug` | One game, or 404 |
| `GET /api/catalog/categories` | Categories with game counts |
| `GET /api/catalog/providers` | Studio list |
| `GET /api/catalog/providers/:slug` | Studio + its games, or 404 |
| `GET /api/catalog/home` | Ordered home rails |

Query parameters are validated with Zod; failures raise `HttpError(400)`.
Express 5 forwards rejected async handlers to the error middleware natively,
so route handlers stay free of try/catch.

**Known duplication:** `apps/api/src/data/seed.js` mirrors
`apps/web/src/data/catalog.js`. This is intentional for now — the web app does
not consume the API yet, so they cannot drift in a way that breaks anything.
When you wire the front end to the API, delete the web copy and let the API be
the single source; or promote the shared seed into `packages/`.

## Asset pipeline

Two scripts, both idempotent and safe to re-run:

- **`npm run fonts:fetch`** — downloads DM Sans and Space Grotesk woff2 from
  Google Fonts (latin subset only), writes them to `public/fonts/`, and
  generates `src/styles/fonts.css`.
- **`npm run assets:gen`** — imports `data/catalog.js` directly (plain ESM, so
  the list is never duplicated) and generates a
  thumbnail per game, a logo per studio, promo art, `favicon.svg`,
  `manifest.webmanifest`, and PNG app icons at 180/192/512.

The PNG encoder in `generate-assets.mjs` is hand-rolled — zlib `deflateSync`
plus CRC32 and the three required chunks — so icon generation needs no native
image dependency. Shapes are drawn with a signed-distance function for
antialiased edges.

Generated output is committed so a fresh clone runs without the scripts.

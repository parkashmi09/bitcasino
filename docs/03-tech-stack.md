# Tech stack

## What this project uses

| Layer | Choice | Version | Why |
| --- | --- | --- | --- |
| UI runtime | React | 19 | Reference target; current stable |
| Build tool | Vite | 7 | Fast HMR, no framework lock-in |
| Language | JavaScript (ESM) | ES2022 | Plain `.jsx`/`.js` in both apps; no build-time type checking |
| Styling | Tailwind CSS | v4 | Matches the reference site exactly |
| Tailwind integration | `@tailwindcss/vite` | 4 | v4's first-party Vite plugin; no PostCSS config needed |
| Routing | React Router | 7 | Client routing without adopting a meta-framework |
| Class merging | `clsx` + `tailwind-merge` | — | Conditional classes where later utilities win |
| API | Express | 5 | Small, familiar; async errors forward to the handler natively |
| Validation | Zod | 4 | Query-parameter parsing at the edge |
| API hardening | `helmet`, `cors`, `morgan` | — | Sane defaults for a dev API |

Node **>= 20.19** is required by Vite 7. `scripts/generate-assets.mjs` imports
the web catalog module directly — it is plain ESM, so no type stripping is
involved. Developed against Node 24.

## Vite, not Next.js

The reference site runs Next.js with PPR and RSC. This project uses Vite + React
Router instead, deliberately:

- The goal is the **UI layer**. Vite keeps the build transparent — no server
  runtime, no framework conventions between you and the CSS.
- Next.js PPR/RSC is a *rendering* strategy. It shapes deploy topology and data
  fetching, not what the page looks like.
- The component tree here is framework-portable. If you later need SSR, SEO or
  streaming, the `components/` and `styles/` directories move into a Next.js
  app largely unchanged; only routing and data loading are rewritten.

**Choose Next.js instead if** you need server rendering for SEO on category and
game pages, per-route caching, or edge middleware for geo-blocking. Those are
real requirements for a live operator — see [09 — Roadmap](./09-roadmap.md).

## Tailwind v4 specifics

v4 removed `tailwind.config.js` in favour of CSS-first configuration. There is
**no config file in this repo by design** — the theme lives in
`apps/web/src/styles/index.css` inside an `@theme` block.

Key v4 differences that affect this codebase:

- `@import "tailwindcss";` replaces the three `@tailwind` directives.
- `@theme { --color-*: … }` defines design tokens; each generates utilities.
- `@theme inline { … }` (used here) makes the generated utility reference the
  custom property *at runtime* rather than inlining its value — which is what
  makes the `.theme-light` / `.theme-dark` swap work without a rebuild.
- Important modifier moved to the end: `hidden!`, not `!hidden`.
- Gradients are `bg-linear-*`, not `bg-gradient-*`.
- Content detection is automatic — no `content: []` array to maintain.

## Dependency policy

Front-end dependencies are kept deliberately thin — no component library, no
CSS-in-JS, no animation library, no icon package. Icons are inline SVG authored
in `components/ui/Icon.jsx`; carousels are native CSS scroll-snap. This keeps
the production bundle at roughly **321 KB (103 KB gzipped)** including React and
the router, and means every visual decision is legible in the source rather
than buried in a vendor theme.

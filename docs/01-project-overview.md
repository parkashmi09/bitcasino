# Project overview

## Goal

Build a production-shaped casino front end in React + Tailwind, using
bitcasino.io as the layout and interaction reference, backed by a small Node
API so the UI has something real to talk to.

## What is reproduced

The things that are *ideas and technique* rather than protected expression:

- **Layout and information architecture** — sticky header, persistent left
  category rail on wide viewports, hero, category shortcut strip, alternating
  horizontal game rails, promotions grid, provider row, fat footer.
- **Interaction patterns** — scroll-snap rails with paging arrows, hover
  reveal on game tiles, slide-over navigation below `xl`, theme toggle.
- **Design tokens** — the palette, type scale, spacing steps, radii and
  breakpoints, which come from the Moon Design System (open source, MIT).
- **Proportions** — the 0.745 portrait ratio for game tiles, the
  14/16 header heights, the 1440px content cap.

## What is deliberately not reproduced

These are the operator's protected property, and copying them into a working
casino UI would be brand impersonation, not a study:

| Not copied | Used instead |
| --- | --- |
| Bitcasino logo and wordmark | `Logo.jsx` — a neutral placeholder mark, same footprint |
| Bitcasino favicon / touch icons | Generated brand-tile icons (`scripts/generate-assets.mjs`) |
| Game thumbnail artwork (licensed to studios like Evolution, Hacksaw, Betsoft) | Generated tiles — gradient base, category emblem and baked-in title, deterministic per slug |
| Studio names and logos | Invented studios — Northlight, Vertex Play, Lumen Games, … |
| Real game titles | Invented titles — Sunken Vault, Lantern Drift, … |
| Marketing and SEO body copy | Original short copy written for this project |
| `Averta Std` (commercially licensed typeface) | DM Sans + Space Grotesk (SIL OFL), which the reference site also ships |

Every placeholder sits behind a clean seam. Swap `apps/web/src/data/catalog.js`
(or point the app at the API) and drop your own art into `apps/web/public/`,
and nothing else has to change.

## Status

The UI shell, design system, routing, asset pipeline and read-only API are
complete and building. Accounts, wallets, real game launches and payments are
out of scope — see [09 — Roadmap](./09-roadmap.md).

## A note on the domain

This is a front-end study, not a gambling operator. Running anything like it
for real money is heavily regulated: it requires a licence in each market,
age and identity verification, AML controls, geo-blocking, certified RNG or
live-studio integrations, and responsible-gaming tooling. None of that is
implemented here, and the footer says so.

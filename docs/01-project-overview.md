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

The UI shell, design system, routing and asset pipeline are complete and
building, and the app now runs on the iBitPlay platform in `backend/` rather
than on static data. **Accounts are real**: a visitor can register, log in —
with 2FA where the account has it — stay signed in across a reload, and log
out. **The catalogue is real**: every rail, grid, provider list and search
reads the platform. **The wallet is real**: the header chip is
`GET /user/wallet/balances`, and the drawer's deposit address is a live
socket read. **And one game is real**: Limbo plays a round against
casino-service that debits, resolves and pays out in one transaction, and the
balance moves.

**And the account is real**: two-factor authentication enables and disables
against the platform, the security page lists where the account is signed in,
identity documents upload for review, and `/profile/transactions` reads every
deposit and withdrawal across all seven payment rails.

**And the marketing side is real**: the blog reads the platform, the spin
wheel spins, the VIP page reports the account's real standing, home banner
art comes from the admin content module, and the footer quotes a live
exchange rate. **And the lobby is live**: the wins ticker and each game's
recent rounds are public socket feeds, and the notification bell reads the
platform's own announcements.

What is not built: the other nineteen in-house originals; the vault, bonuses,
rakeback, gift cards and bank details screens (their routes are live, the
pages are not); chat, which the platform implements and the reference site
does not have; and an end-to-end browser test. Tournaments is a real page
over a local fixture, because the platform has no tournaments table at all.
Aggregator titles are wired but have no provider credentials on this
deployment, so they render "provider not configured" rather than a game.
There is no sportsbook, deliberately.

See [10 — Backend integration](./10-backend-integration.md) for what has
landed and what is next, and [09 — Roadmap](./09-roadmap.md) for the rest.

## A note on the domain

This is a front-end study, not a gambling operator. Running anything like it
for real money is heavily regulated: it requires a licence in each market,
age and identity verification, AML controls, geo-blocking, certified RNG or
live-studio integrations, and responsible-gaming tooling. None of that is
implemented here, and the footer says so.

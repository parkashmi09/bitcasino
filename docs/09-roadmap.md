# Roadmap

What exists, what is stubbed, and what a real deployment would need.

## Done

- Monorepo (npm workspaces), Vite 7 + React 19, plain JavaScript throughout
- Tailwind v4 with Moon-derived tokens and runtime light/dark theming
- Layout shell: header, persistent sidebar, mobile slide-over, footer
- Sections: hero, provider strip, scroll-snap game rails, category strip, promo grid
- Pages: home, category (with provider filters), providers, game detail, 404
- Self-hosted open fonts + fully generated placeholder asset pipeline
- Real accounts against the iBitPlay platform: register, log in, 2FA, rotating
  refresh tokens, session survival across a reload, log out
- `lib/api.js` + `lib/endpoints.js` — the API seam, with the registry checked
  against the backend's own route table by `backend/tools/verify-frontend-routes.js`
- Content and promotions: the blog, the spin wheel, the VIP standing, home
  banner art from the admin module, a live exchange rate in the footer
- Live surfaces: the wins ticker and each game’s recent rounds over public
  socket feeds, and the notification bell over the platform’s announcements
- Hardening: rate-limit handling on both transports, error boundaries on every
  route with the request id surfaced, an ESLint flat config, and CI
- Tests — 168 in Vitest + Testing Library, across the adapters, the query
  layer, the token store, the socket wrapper and the error boundary
- Documentation

## Stubbed

| Area | Current state | Next step |
| --- | --- | --- |
| Data source | ✅ Every page reads the platform through `queries/` and `data/adapters/`; no page imports `data/catalog.js` | — |
| `/providers/:slug` | Renders the index | Build a real detail page |
| `/promotions`, `/vip` | ✅ Real. The spin wheel over `/spin-wheel/*`, the VIP standing and the three periodic bonuses over `GET /user/bonus`, and the account’s own bonus log | A promotion with a *window* — the platform has no table for one, so this is a migration and an admin screen, not a front-end change |
| `/blog` | ✅ Real. Index, category filter and detail over `GET /admin/blogs*` | The fourteen `/help-center/*` links in the footer have no routes and land on the 404. The blog is the surface that could back them |
| `/tournaments` | ✅ Index plus `/tournaments/all/current` and `/tournaments/all/past`, over `data/tournaments.js` | **The platform has no tournaments table and no route that lists one**, and `GET /user/bonus/events` — which Phase 7 planned to compose them from — turned out to be the player’s own bonus log. This one waits on a backend feature, not on wiring |
| Search input | ✅ Debounced, over `GET /casino/games/search`, games and providers | — |
| Log in / Register | ✅ Real, against `POST /api/v1/user/auth/*` | — |
| Account area | ✅ Profile, preferences and referrals are real; two-factor enables and disables over `/2fa/*`; the security page lists active sessions; KYC is a real multipart submission; `/profile/transactions` reads `GET /user/history`; Notifications reads the platform’s own feed | Vault, bonuses, rakeback, wager progress, gift cards and bank details — all six have live routes and none has a screen; Rewards still reads a `data/` fixture |
| Balance chip / Deposit | ✅ Real `GET /user/wallet/balances`, and a drawer whose deposit address is a live `GET_ADDRESS` read; `/profile/transactions` is the ledger view | — |
| Game frame | ✅ Three frames: Limbo is a real socket round on casino-service, an unwired original says so, an aggregator title calls `POST /casino/gis/launch{,-demo}` and renders `GIS_NOT_CONFIGURED` as a state | The other nineteen originals, and provider credentials |
| Skeleton | ✅ On every rail, grid and provider list, on first paint | — |
| Live wins | ✅ `Latest` and `Biggest` over the public `LAST_BETS` and `TOP_WINNERS` socket events, plus each game’s own recent rounds | They are POLLS on a twenty-second interval — the platform answers these on request and broadcasts nothing on them |
| Chat | Not built | `CHATS`, `ADD_CHAT`, `MY_FRIENDS` and `MESSAGES` are all implemented on the platform. The reference site has no chat surface at all, so this would be inventing a feature rather than porting one — and `ADD_CHAT` broadcasts to every connected client, which needs moderation and a report path before it needs a UI |

## Near-term

The first five items here are done. What is left:

1. **An end-to-end test.** The unit suite covers the adapters, the query
   layer, the token store’s single-flight refresh, the socket wrapper, the
   rate-limit rules and the error boundary. Playwright for
   register → log in → view balance → play a round is not there: it needs the
   whole platform up and a browser download, which is the same fixture problem
   `verify:api` has in CI, and it should land with that fixture.
2. **`verify:api` in CI.** The most valuable check in the repository runs only
   by hand, because it needs five processes, a migrated database and a seeded
   catalogue. That is a fixture job, not a step.
3. **A help centre.** Fourteen footer links point at `/help-center/*` and none
   of them is a route. `GET /admin/blogs/category/:category` already serves the
   policy posts they want.
4. **The other nineteen originals.** Limbo establishes the pattern; each of
   the rest is an entry in `IN_HOUSE_EVENTS`, its wire name in
   `socketEvents.js`, and a panel. Nothing in the transport changes.
5. **Code splitting.** One 677 KB chunk. `React.lazy` on the routes is the
   obvious first cut, and the build already warns about it.
6. **Font dedupe.** DM Sans ships as a variable font — one file with
   `font-weight: 400 700` replaces three identical downloads (~74 KB).

## If this becomes a real product

The UI is the easy part. A licensed operator needs all of the following, none
of which is implemented here:

**Regulatory**
- A gambling licence in every market served, and geo-blocking everywhere else
- KYC/AML: identity verification, sanctions screening, transaction monitoring
- Responsible gaming: deposit and loss limits, reality checks, self-exclusion
  (and honouring national self-exclusion registers), age verification
- Jurisdiction-specific advertising rules and mandatory disclosures

**Technical**
- Server-rendered category and game pages for SEO — this is the point at which
  moving to Next.js stops being optional
- Real auth: sessions, 2FA, device management, rate limiting
- Wallet and payments: custody, deposits and withdrawals, ledgering, reconciliation
- Certified game integrations — providers supply launch URLs and session
  tokens; RNG certification is theirs, integration correctness is yours
- Audit logging of every balance-affecting event
- Edge middleware for geo and licence routing

**Product**
- Bonus engine, wagering requirements, tournaments and leaderboards
- Loyalty tiers, responsible-gaming dashboards, transaction history
- Localisation — the reference site runs many locales; the layout already uses
  logical properties, so RTL support is mostly wiring

Treat this repository as the front-end foundation, not a head start on the
regulated parts.

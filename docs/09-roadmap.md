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
- Documentation

## Stubbed

| Area | Current state | Next step |
| --- | --- | --- |
| Data source | Web app reads a local module; the platform serves the real catalogue | Phase 2 of [10 — Backend integration](./10-backend-integration.md) |
| `/providers/:slug` | Renders the index | Build a real detail page |
| `/promotions`, `/vip` | Redirect to `/` | Build the pages |
| `/tournaments` | ✅ Index plus `/tournaments/all/current` and `/tournaments/all/past`, over `data/tournaments.js` | The per-tournament detail page behind each card, and an `Opt in` that posts — both wait on the `bonus` service |
| Search input | Renders, does nothing | Wire to `GET /api/games?q=` with debounce |
| Log in / Register | ✅ Real, against `POST /api/v1/user/auth/*` | — |
| Account area | The account menu, plus `/profile/notifications`, `/profile/rewards`, `/profile/boosts`, `/profile/account`, `/profile/security`, `/profile/settings` and `/profile/refer-a-friend` behind it — `ProfileLayout` carries the reference's nine-tab bar and every tab now leads somewhere, with `Loyalty` leaving it for `/loyalty` and `Tournaments` for `/tournaments`, both as the reference does | Phase 6: the KYC document upload, transactions, and the 2FA enable/disable routes the security page is waiting on |
| Balance chip / Deposit | Not built — no made-up numbers | Phase 4: wallet drawer over `/user/wallet/*` |
| Game frame | Placeholder panel | Provider launch iframe |
| Skeleton | Component exists, unused | Add to rails and grids once data is async |

## Near-term

1. **Wire the catalogue.** Replace `data/catalog.js` imports with TanStack
   Query hooks over `/api/v1/casino/games*`. This is the change the `data/`
   seam exists for, and `lib/api.js` is already the thing that will make them.
2. **Loading and error states.** Every rail and grid needs a skeleton and a
   retry path once data is remote.
3. **Search.** Debounced, with an empty state.
4. **Tests.** There are none. Vitest + Testing Library for the rail scroll
   logic, the theme hook, and the category filter; Playwright for a smoke path.
5. **ESLint config.** `npm run lint` is wired but no flat config exists yet.
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

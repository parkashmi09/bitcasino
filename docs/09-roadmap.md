# Roadmap

What exists, what is stubbed, and what a real deployment would need.

## Done

- Monorepo (npm workspaces), Vite 7 + React 19, plain JavaScript throughout
- Tailwind v4 with Moon-derived tokens and runtime light/dark theming
- Layout shell: header, persistent sidebar, mobile slide-over, footer
- Sections: hero, provider strip, scroll-snap game rails, category strip, promo grid
- Pages: home, category (with provider filters), providers, game detail, 404
- Self-hosted open fonts + fully generated placeholder asset pipeline
- Express 5 read-only API with Zod validation, verified by an endpoint smoke test
- Documentation

## Stubbed

| Area | Current state | Next step |
| --- | --- | --- |
| Data source | Web app reads a local module; API is separate | Point web at `/api`, delete the duplicated seed |
| `/providers/:slug` | Renders the index | Build a real detail page |
| `/promotions`, `/tournaments`, `/vip` | Redirect to `/` | Build the pages |
| Search input | Renders, does nothing | Wire to `GET /api/games?q=` with debounce |
| Log in / Register | Buttons only | See *Accounts* below |
| Game frame | Placeholder panel | Provider launch iframe |
| Skeleton | Component exists, unused | Add to rails and grids once data is async |

## Near-term

1. **Wire the API.** Replace `data/catalog.js` imports with TanStack Query
   hooks. This is the change the `data/` seam exists for.
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

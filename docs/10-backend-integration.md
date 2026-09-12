# Backend integration plan — BitCasino web ⇄ iBitPlay platform

## Context

`backend/` is a complete, production-shaped casino platform: an API gateway on
`:4000` in front of four Express microservices (user `:4001`, admin `:4002`,
casino `:4003`, sports `:4004`) on Sequelize + PostgreSQL, with Socket.io on all
four. 568 HTTP routes, 78 socket events, 163 models, 1095 tests.

`apps/web/` is a React 19 + Vite 7 + Tailwind v4 front end built as a study of
bitcasino.io. Every screen reads static arrays from
`apps/web/src/data/catalog.js`. `apps/api/` is a read-only Express mock that the
web app never actually calls, and it listens on **port 4000 — the same port as
the backend gateway**.

The job is to make the front end run on the real platform. Two constraints shape
every phase:

1. **No sports.** The site has no sportsbook section. sports-service and
   sports-worker stay stopped, and the platform's own kill switch stays off.
   Everything is arranged so turning it on later is configuration, not a
   refactor.
2. **No provider credentials.** `GIS_MERCHANT_ID`/`GIS_MERCHANT_KEY` are unset,
   so `gisgamesnew` — the table every catalogue route reads — is empty and
   aggregator launch calls have no upstream. The catalogue gets seeded from our
   own placeholder data; the **20 in-house games** (`in-house` module: plinko,
   limbo, dice, mine, crash, keno, blackjack, roulette, …) are fully implemented
   locally and are genuinely playable with no provider account at all.

### What the reference site actually exposes

Read from bitcasino.io on 2026-09-07, mapped to the backend module that serves
each one:

| Reference feature | Backend surface |
| --- | --- |
| Header search over games *and* providers | `GET /api/v1/casino/games/search`, `/games/providers` |
| Balance chip + Deposit button | `GET /api/v1/user/wallet/balances`, socket `GET_ADDRESS` |
| Deposit drawer — coin picker, QR, address | socket `GET_ADDRESS`, `GET /api/v1/user/crypto/coins`, `/crypto/chains` |
| Withdraw tab — coin, amount, address, confirm | socket `SUBMIT_NEW_WITHDRAWL`, `GET /api/v1/user/withdrawals/crypto` |
| `Recents` rail | `GET /api/v1/casino/games/recently-played` |
| Originals / Live / Slots / New / Exclusives / Crash / Table rails | `GET /api/v1/casino/games/collections/:collection`, `/casino/games?type=` |
| Themes strip | curated collections (`hot`, `live-casino`, `popular-slots`, `crash`, `indian`) |
| Fun mode / Real mode toggle | `POST /api/v1/casino/gis/launch-demo` / `/gis/launch` |
| Tournaments, Promotions, VIP, Rewards | `bonus`, `spin-wheel`, `affiliate`, admin `banners` |
| Blog, Help Centre | `GET /api/v1/admin/blogs` (public audience) |
| Language + `1 USDT = 94.558 INR` ticker | `GET /api/v1/user/exchange-rate/convert` |
| Payment methods list, licences, legal footer | `GET /api/v1/admin/site-config/public` |
| Sportsbook link | **skipped** |

### Decisions already taken

- Catalogue is **seeded from `apps/web/src/data/catalog.js`** into the real
  tables; a real GIS sync replaces it later without a code change.
- **`apps/api/` is retired.** One source of truth.
- Wallet ships the **full drawer** — balance chip, deposit, withdraw, history.

---

## Where this stands

| Phase | State |
| --- | --- |
| 0 — Environment and data foundation | **Done.** `apps/api` deleted; `vite.config.js` proxies `/api` to the gateway and `/socket.io` to user-service; `backend/.env` carries `CORS_ORIGIN` and `SOCKET_ALLOWED_ORIGINS`; the `catalogue` seeder fills `gisgamesnew`, `gis_providers` and the five collection tables; the sportsbook kill switch is seeded off. See *What Phase 0 actually landed* below. |
| 1 — The API seam | **Done in full.** `lib/endpoints.js` (32 paths), `lib/api.js`, `data/adapters/`, `queries/` on `@tanstack/react-query`, `useSiteConfig`, and the skeleton/error/empty states in `components/ui/QueryState.jsx`. Plus `npm run verify:api` — a live contract check against a running gateway. See *What Phase 1 actually landed* below. |
| 2 — Public catalogue | **Done.** Home, both list pages, providers, search and the game detail shell all read the platform, with skeletons on first paint. No page imports `data/catalog.js`. See *What Phase 2 actually landed* below. |
| 3 — Auth and session | **Done, and re-verified end to end on 2026-09-09** — 9/9 against the live platform, including refresh-token rotation, reuse detection and revocation on logout. One real defect found and fixed in the process (the refresh was **not** actually single-flight). Two routes in its own table are still unwired: email OTP and 2FA-reset-by-email, so there is no password recovery. See *What Phase 3 actually verifies* below. |
| 4 — Socket transport and the wallet | **Done for the drawer.** `lib/socket.js` ships with the wire format, the ack-based `request()` and `ONLINE_LOGGED` rebinding; the deposit address is a real `GET_ADDRESS` read with a QR, and Withdraw is a real form over `SUBMIT_NEW_WITHDRAWL`. A transactions page over the ledger is still ahead. See *What Phase 4 actually landed* below — including **two backend defects found**. |
| 5 — Play | **Done for the seam and one original.** Limbo is a real socket round on casino-service that moves the balance and writes a `bets` row; the other nineteen originals say so rather than pretending; aggregator titles call the real launch routes and render `GIS_NOT_CONFIGURED` as a state. Needed a **second socket connection** and a **second reply envelope**, and found **one backend defect that voided winning rounds**. See *What Phase 5 actually landed* below. |
| 6 — Account area | **The three blockers are done**, plus sessions. Two-factor is a real setup/disable flow over `/2fa/*`, the sessions list is `GET /auth/sessions`, KYC is a real multipart submission, and `/profile/transactions` is a new screen over `GET /user/history`. Profile, preferences and referrals were already real from Phase 3. Vault, bonuses, rakeback, gift cards and bank details are **not** built — see *What Phase 6 actually landed* for what is left and why the Rewards page is still a fixture. |
| 7 — Content, promotions and site config | **Done.** `/promotions`, `/tournaments`, `/vip` and `/blog` are pages rather than redirects; the blog, the banner art, the spin wheel and the VIP standing all read the platform, and the footer quotes a real rate. **One defect found in the audit**: `GET /user/bonus/events` is the player's own bonus log, not the operator's scheduled promotions, and the page was built on the wrong reading — corrected. Tournaments still reads a fixture, because the platform has no tournaments table. See *What Phase 7 actually landed* below. |
| 8 — Live surfaces, hardening, CI | **Six of eight.** The wins ticker and the game-page feed are real socket reads, notifications are a real feed (which needed a **backend fix** — the event had never worked), rate limits are handled on both transports, there are error boundaries on every route, `npm run lint` runs green against a real config, and CI is wired. **Chat and Playwright are not built** and are named rather than skipped. See *What Phase 8 actually landed* below. |

The order is deliberate: 2 and 3 are independent, and accounts were asked for
first. Phase 1 shipped only the parts 3 needs, so `data/adapters/` and the
`@tanstack/react-query` layer are still ahead rather than behind.

### What Phase 3 actually built

**New:** `apps/web/src/lib/endpoints.js`, `lib/api.js`,
`auth/tokenStore.js`, `auth/AuthProvider.jsx`, `auth/guards.jsx`,
`components/layout/UserMenu.jsx`.

**Modified:** `pages/Login.jsx` and `pages/SignUp.jsx` (real submissions,
error codes handled by name, per-field 422 messages), `components/layout/AuthShell.jsx`
(`AuthError`, `Spinner`, an error state on `AuthField`),
`components/layout/Header.jsx` (three states, not two), `App.jsx`
(`AuthProvider`, `RedirectIfAuthenticated` on both auth routes),
`styles/index.css` (the reference's shake and loader),
`backend/tools/verify-frontend-routes.js` (the web registry).

**Motion**, read from the reference's own served stylesheet on 2026-09-08
rather than approximated:

    @keyframes error { 10%,90% {translate(-1px)} 20%,80% {translate(2px)}
                       30%,50%,70% {translate(-4px)} 40%,60% {translate(4px)} }
    animation: .82s cubic-bezier(.36,.07,.19,.97) both error   /* refused credential */
    animation: 1.2s cubic-bezier(.5,0,.5,1) infinite spin      /* in-control loader */

The same read settled a question the other way: the reference has **no**
entrance animation on the auth panel — no `animate-*` utility is emitted for
one — so there is no fade-in or stagger here either.

**Not built, deliberately:** the balance chip and Deposit button that sit left
of the avatar on the reference. Both are Phase 4 wallet surfaces, and a chip
showing an invented number beside a real account is worse than no chip.

> **Superseded.** The chip landed after all, over the real
> `GET /user/wallet/balances` rather than an invented number — see
> *The signed-in header* below.

---

## The signed-in header

The reference's signed-in bar is four controls, and this is now all four:

| Control | Component | Data |
| --- | --- | --- |
| Balance + currency picker + Deposit, as ONE 44px pill | `WalletMenu.jsx` | `GET /user/wallet/balances` |
| `Recents` (clock) | `RecentsMenu.jsx` | `GET /casino/games/recently-played`, fetched on open |
| Notifications (bell) | `NotificationsMenu.jsx` | none — the platform has no player feed |
| Account (avatar) | `UserMenu.jsx` | `AuthProvider` |

All four render only for `status === 'authenticated'`; `loading` gets
skeletons the shape of the row, and `anonymous` still gets Login/Sign Up.

**The geometry is measured, not chosen.** The whole signed-in row is 40px tall
on a 12px radius — not the 44/8 the rest of this site uses — the wallet is a
single bordered box with the Deposit button INSET inside its own padding, and
the header is three flex children (`search flex-1 | wallet | actions flex-1`)
rather than a left group and a right group, which is what floats the wallet
near the middle. Every one of those numbers came off bitcasino.io's live DOM;
**`docs/11-comparing-against-the-reference.md` is the procedure, and it is not
optional before calling a screen done.** The first version of this header was
built from the reference's stylesheet alone and got all four of those wrong.

Shared shapes live in `HeaderMenu.jsx` (trigger, panel, heading, empty state,
divider) and shared dismissal in `hooks/usePopover.js` — every panel listens on
**`pointerdown`**, which is what makes pressing a second trigger close the
first on the way down and open its own on the way up.

Three things worth knowing:

- **Balances are strings, end to end.** `formatBalance` in `lib/format.js`
  groups and pads the digits without ever calling `Number`, and truncates to
  the currency's display precision rather than rounding — rounding up would
  show a player more money than they hold. Per-currency precision and the coin
  disc colour live in `data/currencies.js`, keyed to the backend's own
  `SUPPORTED_CURRENCIES` allow-list.
- **The bell carries no unread pip.** There is no notification route in
  user-service (`club-broadcasts` and the `social` socket are not it), and a
  pip is a claim that something is waiting.
- **Deposit opens `DepositDialog.jsx`** — the reference's end-edge drawer with
  its Deposit/Withdraw tabs, a coin picker, and the real balance. The address
  itself is a `GET_ADDRESS` socket read, so it is the one thing the drawer does
  not fabricate: it says what it is waiting for instead. A player can send real
  money to an address they read on this screen, which is why the honest empty
  state is the feature and not a placeholder to be filled in with something
  plausible. The full drawer — history, withdraw form, QR — is still Phase 4.

Two defects were found and fixed while wiring this up, both the same shape —
a guard that counted effect RUNS in a tree StrictMode double-invokes:

- **`AuthProvider`'s bootstrap never finished.** The `cancelled` flag and the
  `bootstrapped` ref contradicted each other: StrictMode's teardown set the
  flag on the only run the ref allowed, so a reload with a stored session sat
  on the header's skeleton forever with a 200 from `/auth/refresh` and a 200
  from `/auth/me` in the network panel. The signed-in header could not appear
  at all after a reload. The flag is gone; the ref stands.
- **`RouteProgress` froze at 8% on every hard load.** Its `firstRender` boolean
  was flipped by the first effect run, so the second run read "this is a
  navigation" and started the bar, whose timers were then torn down — leaving a
  3px orange bar across the top of the page and the spinner parked over the
  account control. It is keyed on the location now, so a repeated run is a
  no-op however many times React runs it.

---

## Things to know before starting

**The response envelope.** Every route answers
`{ success, data, meta? }` or `{ success: false, error: { code, message, details.requestId } }`.
`data` is never absent on success. `204` sends **zero bytes** — branch on status
before parsing. 55 routes answer *outside* the envelope (marked **raw** in
`backend/docs/API-ROUTES.md` Appendix A); the two the web app touches are
`GET /api/v1/user/wallet/history` (`{history, count}`) and the banner/blog image
routes (binary).

**Pagination has three conventions.** `limit`/`offset` for most lists,
`page`/`limit` for games/blogs/gis/bet-history, `page`/`per_page` for js-games.
Validators are `.strict()` — sending the wrong pair is a **422**, not a silent
default. The answer is always `meta.pagination`, never `meta.total`.

**Money is a string, always.** `"12.50000000"`. Balances are `NUMERIC(30,8)`; a
JSON number cannot carry that. Never parse a balance into a JS number for
arithmetic — only for display.

**Two audiences reach the browser.** `public` and `user` mount at the *same*
path; only the guard differs. `/internal/*` is refused at the gateway.

**Sockets are hashed opaque names** and payloads are `encode`/`decode`d by
`@ibitplay/socket`. The reply envelope is `{status: true, ...}` /
`{status: false, msg, error: {code}}` — `status`, not `success`.

---

## Phase 0 — Environment and data foundation

Goal: the platform runs beside the web app, with a catalogue in it.

**Retire `apps/api`.**
- Delete `apps/api/`; drop it from `workspaces` and from the `dev`/`dev:api`
  scripts in the root `package.json`.
- `apps/web/src/data/catalog.js` stays for now — it becomes seeder input in this
  phase and page-level fallback disappears over Phases 2–7.

**Backend bring-up** (all commands from `backend/`):
- PostgreSQL ≥ 14 running; `npm run setup` writes `.env`, generates the eight
  secrets, creates the DB, migrates and seeds. `npm run setup:demo` adds staff,
  players with balances, and prints credentials.
- **On an environment that is already configured, do not run `setup`.** It
  writes `.env` and regenerates the secrets, which invalidates every token the
  running deployment issued. Seed in place instead:
  `node scripts/seed-data.js` for the config sets and
  `node scripts/seed-data.js --demo` for staff and funded players. Both are
  idempotent; `--only <set>` runs one.
- Confirm `CORS_ORIGIN` in `backend/.env` contains `http://localhost:5173`
  (the shipped `.env.example` already lists it) and set
  `SOCKET_ALLOWED_ORIGINS` to the same — it has **no default**, and an unset
  value means no browser origin connects.
- Start only what we need: `npm run dev user admin casino gateway`. The dev
  runner (`backend/scripts/dev.js`) takes service names as arguments.

**Turn sports off properly.** With sports-service stopped, `GET /health`
reports `degraded` (503) because the aggregator probes all four targets — that
is cosmetic, but the honest switch is the platform's own kill switch:
`PUT /api/v1/admin/site-config/sports` with a staff token, which
sports-service reads over `/internal/admin/site-config/sports`. Do both: stop
the process, flip the flag. Nothing else in the repo needs to know sports
exists.

**Seed the catalogue.** Add a `catalogue` set to `backend/scripts/seed-data.js`
alongside the existing `games` set (which registers the 20 in-house games into
`js_games`). It should:
- Insert `apps/web/src/data/catalog.js` `GAMES` into `gisgamesnew` —
  `uuid` (from slug), `name`, `provider`, `type` (our `category`), `image`
  (`/images/games/<slug>.svg`), `has_lobby`, `is_mobile`, `technology`.
  `gisgamesnew_uuid_key` is a real unique constraint, so the insert can be
  `ON CONFLICT DO UPDATE` and re-runnable, matching the existing sets.
- Fill the five curated-collection tables (`hot_games`, `live_casino`,
  `popular_slots`, `crash_games`, `indian_games`) — each is one row with a
  `key` and a comma-separated `game_uuids` string, per
  `casino/games.constants.js` `COLLECTIONS`.
- Register the 20 in-house games in `gisgamesnew` too, typed `originals`, so
  the Originals rail and the search index find them.

**Vite proxy.** `apps/web/vite.config.js` already proxies `/api` →
`http://localhost:4000`; that now hits the gateway, whose paths all start
`/api/v1`. Add a `/socket.io` proxy with `ws: true` pointed at
`http://localhost:4001` (user-service) — the socket servers are attached to
each service's own port, not to the gateway.

**Done when:** `curl localhost:4000/api/v1/casino/games?limit=5` returns seeded
rows through the gateway, and `npm run dev` from the repo root brings up the web
app alone.

### What Phase 0 actually landed

Everything above, plus three things the plan did not anticipate. Landed
2026-09-09; measured, not assumed.

**The database was migrated but never seeded.** 36 migrations applied, 0
pending — and `gisgamesnew` 0 rows, all five collection tables 0 rows,
`siteconfig` **0 rows**, `js_games` 4 of 20, `wallets` 0. The `catalogue`
seeder had in fact been written; it had simply never been run. So the honest
reading of the phase table before this ran is that Phases 3 and 4 were done in
*code* against a platform with no data in it — the balance chip could not have
shown a real balance, because no wallet existed to hold one.

Now: 44 games in `gisgamesnew` (24 from `catalog.js` + the 20 in-house),
9 providers, 7 types, all five collections filled, 5 demo players funded
10 000 INR each.

**`gis_providers` is a second catalogue, and nothing derived it from the
first.** `GET /casino/games/providers` reads the `gis_providers` table;
`GET /casino/games/stats` counts `DISTINCT provider` on `gisgamesnew`. Seeding
only the games left the two disagreeing — stats reporting nine providers while
the providers list returned `{rows: [], total: 0}`, which is Phase 2's
`/providers` page rendering empty on a catalogue that visibly has providers in
it. The `catalogue` set now fills it.

The table is one `text` column with **no primary key and no enforced unique
index** (the generated model says so in its own header), so `ON CONFLICT` has
no arbiter to name. Re-runnability there is `INSERT … WHERE NOT EXISTS`.

**The sports kill switch is seeded, not clicked.** `sportsEnabled()` reads a
*missing* `siteconfig` row as `true`, so an unconfigured deployment is one
where sports is ON and only a stopped process hides it. Flipping it through
`PUT /api/v1/admin/site-config/sports` is also not available on a fresh
install: the seeded super-admin is role 1, and role 1 is refused at login with
`STAFF_AUTH_TWO_FACTOR_ENROLMENT_REQUIRED` until somebody enrols 2FA.

So the `siteconfig` set writes `sports` on every run, existing row included —
it is the one flag whose value here is a deployment decision rather than a
default to leave alone. `SEED_SPORTS_ENABLED=true` turns the board back on,
which is step 4 of *Sports: excluded, and how to switch it on* below.

`home_livesports` is left at its default `true`. It gates a home-page section
this front end does not have, so nothing reads it; it becomes meaningful only
if the sportsbook is switched on.

**Two corrections to this document, from the running platform:**

- `GET /user/wallet/balances` answers a **flat `{CURRENCY: "0.00000000"}` map**
  of 28 currencies, not the `{userId, balances}` in the Phase 4 table.
  `WalletMenu.jsx` already reads the flat shape, so the code was right and the
  table was wrong.
- `POST /api/v1/admin/auth/login` takes **`email`**, not the `identifier` that
  the *player* login takes. They are different validators; only `user/auth`
  accepts one field for username-or-email-or-phone.

**Verified:** `npm run verify:modules`, `node tools/verify-frontend-routes.js`
(18/517), `npm run db:verify` (163 models match), `npm run build`. Player login
→ `/auth/me` → `/wallet/balances` returns `INR = 10000.00000000` over the
gateway. The seeder is idempotent — a second `--only catalogue` run leaves 44
games and 9 providers, not 88 and 18.

**Still true and still cosmetic:** `GET /health` on the gateway answers `503
degraded`, because the aggregator probes all four service targets and
sports-service is deliberately stopped.

---

## Phase 1 — The API seam

Goal: one place that knows how to talk to the platform. No page changes yet.

**`apps/web/src/lib/endpoints.js`** — a flat registry of every path the app
calls, grouped by service root (`const CASINO = '/api/v1/casino'` …). This
mirrors the two registries `backend/tools/verify-frontend-routes.js` already
parses. Register it there (`REGISTRIES` + `SOURCES` at the top of that file,
resolved from the repo root, which is `D:\CFZ\BitCasino`) so a renamed backend
route breaks CI instead of a page.

**`apps/web/src/lib/api.js`** — the fetch wrapper:
- Unwraps `{success, data, meta}`; throws an `ApiError` carrying
  `code`, `message`, `status` and `details.requestId` on failure.
- Returns `null` for `204` **without parsing the body**.
- Takes a `raw: true` escape hatch for the handful of non-enveloped routes.
- Attaches `Authorization: Bearer` from the token store (Phase 3); until then
  it is a no-op.
- Single-flight refresh on `401` (Phase 3 wires the actual refresh call).

**`apps/web/src/data/adapters/`** — pure functions mapping platform shapes onto
the `Game` / `Provider` / `Category` typedefs already documented in
`apps/web/src/data/types.js`. This is what keeps `GameCard`, `GameRail`,
`GameList`, `ProviderRail` and every section component unchanged:
`gisgamesnew.uuid → id`, `name → title`, `type → category`,
`provider → provider`, `image → thumb`. Fields the platform does not carry
(`rtp`, `volatility`, `hitRatio`) become optional — the sort control in
`GameList` must degrade rather than sort on `undefined`.

**Query layer.** Add `@tanstack/react-query`, a `QueryClientProvider` in
`apps/web/src/main.jsx`, and `apps/web/src/queries/` hooks. This is exactly the
swap `docs/05-architecture.md` reserves the `data/` seam for.

**Feature flags.** `useSiteConfig()` over
`GET /api/v1/admin/site-config/public` (public + rate-limited). It returns the
`PUBLIC_FLAGS` set — top-level features, game categories, currencies offered,
and `home_*` section toggles — plus public amounts. An absent config row reads
as ON, and the client must default the same way so first paint does not
flicker. Use it to drive which home sections and currencies render; the
sportsbook flag is deliberately *not* in this set, which is fine because the UI
has no sports surface to gate.

**Loading and error states.** `apps/web/src/components/ui/Skeleton.jsx` exists
and is unused — this is where it starts being used. Every rail and grid needs a
skeleton and a retry path, and the error copy should surface
`details.requestId`, which is what a bug report quotes.

**Done when:** `apps/web/src/lib/api.js` can fetch a game list in a scratch
component, and `node tools/verify-frontend-routes.js` passes with the new
registry.

> **Landed** — `api.js` and `endpoints.js` ship, and
> `node tools/verify-frontend-routes.js` reports *every registry endpoint
> resolves to a mounted route* over the eight auth paths. The adapters, the
> query layer and `useSiteConfig` are still ahead: nothing renders remote
> catalogue data yet, so there is nothing for them to adapt.
>
> One addition the plan did not anticipate: a failure that arrives **without**
> the envelope is not from the platform's error handler at all — in
> development it is the Vite proxy answering 500 for a gateway that is not
> running. Reading `error.message` off that yields "Request failed", so
> `api.js` maps unenveloped 5xx to `GATEWAY_UNAVAILABLE` / `SERVER_ERROR`
> with a message that says what is actually wrong.

### What Phase 1 actually landed

The rest of it, on 2026-09-09: `data/adapters/`, `queries/` on
`@tanstack/react-query`, `useSiteConfig`, and the loading/error/empty states.
No page was migrated — that is Phase 2 — so nothing here changed a screen.

**New:** `data/adapters/{categories,games,providers,siteConfig,index}.js`,
`queries/{client,keys,params,games,providers,siteConfig,index}.js`,
`components/ui/QueryState.jsx`, `scripts/verify-api-contract.mjs`, and three
test files.
**Modified:** `lib/endpoints.js` (7 catalogue paths + site-config, 25 total),
`lib/api.js` (one fix, below), `main.jsx` (`QueryClientProvider`),
`vite.config.js` (a `test` block), both `package.json`s.

#### Three decisions worth recording

**Provider slugs are derived, and resolved by lookup rather than inversion.**
`gis_providers` is one `text` column — no id, no slug — and
`GET /games/provider/:provider` takes the **name**. The static catalogue had
hand-written slugs (`Northlight Studio` → `northlight`), which cannot survive a
sync that brings several hundred studios. So the slug is derived
(`northlight-studio`) and `/providers/:slug` resolves it by searching the
providers list it already fetches. Inverting `slugify` would have to guess at
capitalisation, which breaks on `In-House` and `NetEnt`. **Provider URLs
therefore change** — `/providers/northlight` becomes
`/providers/northlight-studio`. Nothing links to the old ones.

**The query parameters are a module, not inline in the hooks.** Every
catalogue validator is `.strict()` and they do not accept the same keys — a
collection takes `page`+`limit` and refuses `type`; search takes `q`+`limit`
and refuses `page`; the per-provider route refuses `provider`, which is in its
path. Wrong key means **422 before the handler runs**, and a 422 on a list
renders as an empty rail, so the mistake is invisible. `queries/params.js`
holds all five builders, and `scripts/verify-api-contract.mjs` sends **those
exact objects** to a live gateway — a script with its own hand-rolled params
would verify the script rather than the app.

**`useSiteConfig` never has a loading state, and fails open.** It returns a
usable config immediately with every flag ON, matching what the backend answers
for a missing row. Defaulting off would assemble the home page in front of the
player. The failure path defaults the same way — losing the config must not
hide the site — which is also why anything that has to be OFF when unknown does
not belong in this flag set.

#### Bugs found and fixed while building it

**`apiWithMeta` bypassed the envelope check.** It has to read the raw body to
see `meta`, and `raw: true` skips the `success !== true` guard that `send()`
applies to unwrapped calls. A 200 carrying something that is not the envelope —
the dev server answering `index.html` for an unmatched proxy path is the one
that happens — returned `{data: null, meta: null}`, so every list in the app
would have rendered its empty state instead of an error. An empty catalogue and
a broken one must not look the same.

**Deriving an asset path from a slug 404s, silently.** Two instances, both
found by the contract check rather than by looking:

- Five of nine provider logos. The slug is `northlight-studio`; the file is
  `northlight.svg`. `assets.generated.js` was no help — it indexes the 68
  reference studios, and our eight placeholder logos are written by a different
  script and are not in it.
- Three of seven category placeholders. `crash` is served from
  `crash-instant-win.png`, `live-casino` from `live-games.png`, and
  `video-slots` is an `.svg` where the rest are `.png`.

A missing image reaches nothing — the browser draws its broken-image glyph and
no error is logged — so both are now explicit tables, and the contract check
asserts every path they can emit exists under `public/`. `logo` is **`null`**
for a studio we have no art for, rather than a plausible-looking path: a real
sync brings hundreds, and inventing a path just moves the 404 somewhere harder
to find. That makes `Provider.logo` `string | null`, where `data/types.js`
still declares `string` — Phase 2's renderer must handle it.

#### Verification

    npm test                    # unit tests (102 at the end of Phase 4)
    npm run verify:api          # 35 live checks, needs the gateway up
    npm run build
    cd backend && node tools/verify-frontend-routes.js   # 25/517

`npm run verify:api` is the one worth knowing about. It imports the app's own
param builders and adapters, runs them against a live gateway, and asserts
things the other three cannot:

- every category and all five collections answer without a 422;
- every row adapts to something **renderable** — a missing field produces
  `undefined`, which renders as nothing rather than as an error;
- `gis_providers` and `gisgamesnew` still agree on the provider count, which is
  the Phase 0 defect that would return the moment a sync filled only one;
- every catalogue `type` still maps to one of our seven;
- a wrong parameter is still **refused** — it sends `offset` to `/games`,
  `type` to a collection and `page` to search, and fails if any is accepted,
  because the guarantee that a mistake is loud disappears silently if the
  platform ever stops being `.strict()`.

Confirmed in a browser as well: the app boots with no console output beyond
Vite's own, the real modules fetch through the Vite proxy and adapt correctly,
and all 58 distinct image URLs the adapters emit return 200.

---

## Phase 2 — Public catalogue

Goal: every signed-out screen reads the platform. `catalog.js` stops being
imported by pages.

| Screen | Route |
| --- | --- |
| Home rails | `GET /casino/games/collections/:collection` per rail; `GET /casino/games?type=&page=&limit=` for the rest |
| Themes strip (`ThemeRail`) | the five curated collections |
| `/categories/:slug` | `GET /casino/games?type=<slug>&provider=&page=&limit=` (**page-based**) |
| `/games/:slug` collections | `GET /casino/games/collections/:collection` |
| `/providers` | `GET /casino/games/providers` |
| `/providers/:slug` | `GET /casino/games/provider/:provider` |
| `/play/:category/:slug` | one game out of `GET /casino/games?search=` (see note) |
| `SearchDialog` | `GET /casino/games/search?q=&limit=` debounced |
| Category counts / nav badges | `GET /casino/games/stats` → `gameTypes`, `topProviders` |
| Live wins ticker | `GET /casino/bet-history/live` (public) |
| Jackpot figures | `GET /casino/catalogue/jackpots` |

**Category mapping.** Our seven slugs (`originals`, `live-casino`,
`video-slots`, `table-games`, `crash`, `game-shows`, `jackpots`) are our own;
`gisgamesnew.type` is whatever the upstream sync writes. Because we seed the
catalogue in Phase 0 we control both sides today — keep the mapping in **one**
table in `apps/web/src/data/adapters/categories.js` so a real GIS sync later
needs a change in one file, not seven.

**There is no `GET /games/:uuid`.** The catalogue exposes lists and search, not
a single-game read. `Play.jsx` should resolve its game from the search endpoint
by slug/uuid, and the query cache will usually already hold it from the rail the
user clicked. Flagged as a candidate backend addition rather than worked around
twice.

**Done when:** the home page, both list pages, providers, search and the game
detail shell render entirely from the API with skeletons on first paint, and
`grep -r "from '@/data/catalog'" apps/web/src/pages` returns nothing.

### What Phase 2 actually landed

Landed 2026-09-09. Every screen in the table above now reads the platform, and
the grep is clean. Three components still import `catalog.js` and are meant to:
`HomeBanner` and `PromoGrid` are Phase 7's admin-content surfaces, and
`Testimonials` is marketing copy the platform has no route for. `catalog.js`
itself stays regardless — the Phase 0 seeder reads `GAMES` out of it.

**New:** `data/adapters/collections.js`, `data/categories.js`,
`data/homeRails.js`, `queries/collections.js`,
`components/sections/CatalogueRail.jsx`,
`components/sections/LatestWins.jsx`, `hooks/useDebounced.js`.
**Rewritten:** `pages/{Home,Category,Provider,Providers,Play}.jsx`,
`components/sections/{ThemeRail,ProviderRail}.jsx`,
`components/layout/SearchDialog.jsx`, `hooks/useRecentlyPlayed.js`.

#### The route decides, not the slug

`live-casino` and `crash` are **both** one of our seven categories and one of
the platform's five curated collections, and they list different games — the
collection is a row an operator picked, the category is every game of that
type. `/games/live-casino` returns 5 and `/categories/live-casino` returns 3.

`Category.jsx` therefore takes an explicit `mode` prop from `App.jsx`.
Resolving by slug alone would have made one of the two routes permanently
unreachable, and which one would depend on the order of a lookup.

#### Three lists the catalogue API cannot serve

`new`, `exclusives` and `live-rtp` are cut client-side out of one fetched page,
because `GET /casino/games` accepts no `label` filter and no sort — and `label`
is where `new`/`hot`/`exclusive`/`jackpot` live, while `rtp` is a key inside
the `parameters` JSONB rather than a column.

That is honest for a 44-game placeholder catalogue and does **not** scale:
against a real sync, "new" would mean "the newest among the first 100 rows the
API happened to return". Two ways out, neither of them this phase's job — add a
`label` filter to `games.validators.js` (smaller, and keeps an operator from
hand-curating "new releases"), or curate them upstream, which
`PUT /casino/games/collections/:collection` already supports and simply has no
slug for. `data/adapters/collections.js` carries this note at the call site.

`GET /casino/catalogue/jackpots` is **not** wired up: it answers
`CATALOGUE_NOT_CONFIGURED` without `CASINO_HUB_KEY`, a provider credential this
deployment does not have. Registering it would ship a jackpot figure that can
only ever be an error.

#### Bugs found and fixed while building it

**Two hooks shared a cache key and disagreed about the shape.** React Query
caches by key and runs `select` per observer, so `useCutSource` caching a bare
array under `games.list({page:1, limit:100})` meant the search dialog — reading
the same entry through `useGames` — destructured `rows` off an array, got
`undefined`, and rendered "Most Popular Games — 0" **with no request in the
network panel at all**. Nothing threw. Every `games.list` fetch now goes
through one `fetchGameList`, and two tests assert the sharing works in either
mount order, because a fix that only works one way round is not a fix.

**`Play.jsx` could not be right with either search route.** They differ in a
way that is not obvious:

| | `GET /games?search=` | `GET /games/search?q=` |
| --- | --- | --- |
| Matches | `name` **only** | name **or uuid**, ranked |
| `parameters`, `images`, `label` | **yes** | no |

A `/play/:category/:slug` URL carries the uuid. The browse route has the fields
but cannot find the row — `cobalt-sky` never matches the name `Cobalt Sky`, so
the page read "Game not found". The search route finds the row but not the
fields — `parameters` is where `inHouse` lives, so **Plinko was offered a
"Provider frame mounts here" placeholder** when it is not waiting on a provider
at all. Both of those were real, one after the other. `useGame` now does both:
search resolves the uuid to a name, browse fetches the full row by that name.
`GET /games/:uuid` would collapse it to one request that cannot be wrong.

**`GameList`'s sort could scramble a whole page.** `b.rtp - a.rtp` over a game
the platform carries no RTP for is `NaN`, and a comparator returning `NaN` is
not a valid comparator — `Array.prototype.sort` may leave the array in any
order, so one unrated game misplaces every other. Sorting now goes through
`sortValue` and unrated games take a defined position: last, either direction.

**Every tile in the Themes strip was a 404.** The six static `THEMES` linked to
`/themes/:slug`, and there has never been a `/themes` route in `App.jsx` — the
"See all" too. The strip is the platform's five curated collections now, each
linking to `/games/:collection`.

**`useRecentlyPlayed` had its own second copy of `toGame`.** It derived the slug
with `slugify(name)`, so `/play/…` worked only while a title happened to
slugify to its uuid, and it defaulted an unmapped `type` to `video-slots`,
filing a game under a category it is not in. It is a thin wrapper over the
shared query hook now.

#### Verification

    npm test                 # unit tests (102 at the end of Phase 4)
    npm run verify:api       # 48 live checks
    npm run build
    cd backend && node tools/verify-frontend-routes.js   # 26/517

`verify:api` grew to cover the phase: every home rail resolves through the
source it actually uses, every Themes tile links to a list that exists, each
client-side cut still finds something, and the live-wins feed answers a list.

Driven in a browser as well, with no console output beyond Vite's: seven rails
and 43 tiles on the home page, 0 broken images out of 120, `/games/live-casino`
and `/categories/live-casino` returning different lists, `/games/not-a-real-list`
and `/providers/nope` reaching their own not-found states, Plinko and Cobalt Sky
both resolving on a cold load with the right placeholder, and the search dialog
going 44 popular → 1 result for "sky" → "Nothing found" over the fallback list.

---

## Phase 3 — Auth and session

Goal: real accounts. `Login.jsx` and `SignUp.jsx` stop apologising for being a
study.

| Action | Route |
| --- | --- |
| Register | `POST /api/v1/user/auth/register` → `201`, returns tokens *and* signs in |
| Log in | `POST /api/v1/user/auth/login` (rate-limited) |
| Refresh | `POST /api/v1/user/auth/refresh` |
| Log out | `POST /api/v1/user/auth/logout` (`allSessions` for "sign out everywhere") |
| Current user | `GET /api/v1/user/auth/me` |
| Sessions list | `GET /api/v1/user/auth/sessions` |
| Change password | `POST /api/v1/user/auth/change-password` |
| Email OTP | `POST /api/v1/user/email/otp`, `/otp/verify` |
| 2FA reset by email | `POST /api/v1/user/email/2fa/reset`, `/reset/confirm` |
| Referral code check | `GET /api/v1/user/profile/verify-referral/:code` (public) |

**Field mapping — read `backend/services/user/src/modules/auth/auth.validators.js`
before touching the forms.** Login takes **`identifier`** (username, email *or*
phone in one field), `password`, optional `twoFactorCode` (exactly 6 digits) and
`deviceLabel`. Register takes `username`, `password` (**minimum 10 characters**,
no composition rule), and optional `email`, `phone`, `country`, `referredBy`.
Note `referredBy` is *somebody else's* code, not the account's own
`referalcode` — they are one letter apart in the database and mean opposite
things. All validators are `.strict()`: an extra field is a 400, so
`SignUp.jsx`'s current form state must be filtered, not spread.

**`Login.jsx` already has the 2FA checkbox** ("I use Google Authenticator") —
wire it to reveal a 6-digit field that fills `twoFactorCode`.

**Token store.** Access tokens are short-lived (`JWT_ACCESS_TTL=15m`), refresh
tokens live 30 days and **rotate** — a used refresh token is revoked and the
whole chain dies if one is replayed. Keep the access token in memory and the
refresh token in `localStorage`, with a single-flight refresh in `api.js` so ten
concurrent 401s produce one refresh, not ten (which would revoke the chain).

**`AuthProvider`** in `apps/web/src/auth/` exposing `user`, `status`,
`login`, `register`, `logout`. `Header.jsx` swaps its two buttons
(lines 84–87) for the signed-in cluster: balance chip, Deposit button, avatar
menu. Add a `RequireAuth` wrapper for account routes in `App.jsx`.

**Error codes to handle by name**, never by message: `ACCOUNT_LOCKED`,
`ACCOUNT_INACTIVE`, `AUTH_INVALID_CREDENTIALS`, `AUTH_2FA_REQUIRED`,
and the gateway's rate-limit code — login is metered at 10 per 15 minutes
(`AUTH_RATE_LIMIT_MAX`) and registration at 20 per hour.

**Done when:** a seeded demo player can register, log in, survive a reload, hit
a 15-minute expiry and be refreshed transparently, and log out.

> **Landed.** Two details worth recording because they are not obvious from the
> route table:
>
> - **`AuthProvider`'s bootstrap runs behind a ref.** StrictMode mounts effects
>   twice in development, and the bootstrap exchanges a rotating refresh token.
>   Running it twice presents the same token twice, which the backend reads as
>   a captured token and answers by revoking every session the account has —
>   so a development-only double-mount would sign the player out of every
>   device. The ref is load-bearing, not tidiness.
> - **`SignUp` projects, it does not spread.** The form collects date of birth,
>   a dial code and two consent flags; the register validator declares six
>   fields and is `.strict()`. `body()` is the single place that decides what
>   is sent, the dial code is joined onto the number, and the date of birth is
>   the age gate rather than a column.

### What Phase 3 actually verifies

Re-checked on 2026-09-09 against the running platform rather than taken on
trust, because the status table had already been wrong about Phases 0 and 1.

**Nine of nine, live:**

| Check | Result |
| --- | --- |
| `POST /auth/register` | `201`, tokens returned — one round trip creates and signs in |
| `POST /auth/login` | `200` |
| `GET /auth/me` | the registered username |
| `GET /auth/sessions` | `200`, sessions listed |
| `POST /auth/refresh` | `200`, and the refresh token **rotates** |
| Replaying the rotated token | `401 AUTH_REFRESH_TOKEN_REUSED` |
| Wrong password | `AUTH_INVALID_CREDENTIALS`, by code |
| `POST /auth/logout` | `200` |
| Refresh after logout | `401 AUTH_SESSION_REVOKED` |

In the browser: a reload survives on the refresh token alone (the access token
never leaves memory — `tokenStore` persists only `bc.auth.refresh`), and an
expired access token is exchanged transparently under ten concurrent reads.

#### The refresh was not single-flight, and now is

The plan is explicit that ten concurrent 401s must produce **one** refresh, not
ten, because refresh tokens rotate and the backend answers a replayed one by
revoking every session the account has. Measured, it produced **two**.

`refreshInFlight` is cleared in a `.finally()` the instant the exchange
settles. Ten requests that 401ed together resolve milliseconds apart, so the
later ones find the latch already released and start their own refresh — the
guard only covers callers that arrive *during* the exchange, not the ones
arriving just after it.

Two is not ten and nobody was signed out: the second exchange read the
already-stored new token, so it was a rotation rather than a replay. But it
rotates the chain for no reason, and under different timing the extra exchange
is exactly what a replay looks like.

`send()` now compares the access token it *sent* against the one in the store
before deciding to refresh. If they differ, somebody else's refresh already
landed and it simply retries. Re-measured: **one** refresh for ten concurrent
401s. `lib/api.test.js` pins it, along with the three failure paths — no
refresh token to spend, a refused refresh (session cleared), and a refresh that
cannot reach the server (session deliberately **kept**, because a network blip
is not proof the session died).

#### Two routes in the Phase 3 table are not wired

`POST /user/email/otp` and `/otp/verify`, and `POST /user/email/2fa/reset` and
`/reset/confirm`. Neither is in `lib/endpoints.js` and neither has a screen.

The practical consequence: **there is no password recovery.** `/forgot-password`
in `App.jsx` is a `Navigate to="/login"`, so a player who forgets their password
has no route back into their account, and a player who loses their authenticator
cannot clear 2FA. The done-when does not mention either, which is why the phase
still reads as done — but they are the two most-used recovery paths on a real
casino and they are absent, not deferred by design.

#### A correction to this document

The plan's error-code list says `AUTH_2FA_REQUIRED`. **No such code exists.**
`auth.errors.js` builds its codes from the `AUTH` prefix plus the key, so the
real ones are `AUTH_TWO_FACTOR_REQUIRED` and `AUTH_TWO_FACTOR_INVALID` — which
is what `Login.jsx` branches on, so the code is right and the table was wrong.
Likewise `ACCOUNT_LOCKED` and `ACCOUNT_INACTIVE` are `AUTH_ACCOUNT_LOCKED` and
`AUTH_ACCOUNT_INACTIVE` on the wire.

#### Housekeeping

`localStorage` on the dev origin also holds `ibitplay:accessToken`,
`ibitplay:accessTokenExpiry` and `ibitplay:refreshToken`. **Nothing in
`apps/web/src` reads or writes those keys** — they are leftovers from another
client on `localhost:5173`. Inert, but they are real tokens sitting in storage;
worth clearing, and worth noting that this app's own access token is never
written there.

---

## Phase 4 — Socket transport and the wallet

Goal: the header chip is real money, and the Deposit/Withdraw drawer works.

**Socket client first** — `apps/web/src/lib/socket.js`. Add `socket.io-client`,
connect to user-service with `auth: { token }`, and wrap `encode`/`decode` plus
the `EVENTS` name table. Three things that bite:
- The wire names are **opaque hashes** and one wrong character fails silently —
  copy them from `backend/docs/SOCKET-API.md` §9, do not retype.
- Always pass an **ack callback**; with concurrent requests, listening on the
  event name cannot tell which reply belongs to which request.
- A visitor who signs in on an already-open socket must send **`ONLINE_LOGGED`**
  with the new token to rebind the connection, or every `player` event is
  refused until they reload.

**Wallet, HTTP:**

| Surface | Route |
| --- | --- |
| Balance chip, currency switcher | `GET /api/v1/user/wallet/balances` → `{userId, balances}` |
| One currency | `GET /api/v1/user/wallet/balances/:currency` |
| Ledger | `GET /api/v1/user/wallet/ledger?limit=&offset=` (**offset-based**) |
| Legacy history | `GET /api/v1/user/wallet/history` — **raw** `{history, count}`, not the envelope |
| Deposits / withdrawals / transfers | `GET /api/v1/user/history/*` |
| Withdrawal list + summary | `GET /api/v1/user/withdrawals/crypto`, `/summary` |
| Coins and chains for the picker | `GET /api/v1/user/crypto/coins`, `/crypto/chains` (public) |
| Fiat/PSP deposit orders | `POST /api/v1/user/payments/deposits`, `GET /payments/methods/:provider` |
| Swap between coins | `GET /api/v1/user/swap/estimate`, `POST /api/v1/user/swap` |
| Rate ticker (`1 USDT = … INR`) | `GET /api/v1/user/exchange-rate/convert` (public) |

**Wallet, socket:** `GET_ADDRESS` (deposit address for a coin+chain),
`SUBMIT_NEW_WITHDRAWL` (requires the account password — verified against the
hash before anything moves), `SUBMIT_NEW_SWAP`, `WALLET_HISTORY`, `SEND_TIP`.

**Gap to decide on, not to work around.** The deposit address is a socket-only
read — there is no HTTP equivalent. `GET_ADDRESS` is a plain `SELECT` on
`wallets` and returns `{coin, chain, address, allocated}`, answering
`allocated: false` when no address exists rather than inventing one. Two
options: use the socket client we just built (no backend change), or add a
`GET /api/v1/user/crypto/addresses` player route to the `crypto` module — a
~20-line addition that follows the module's existing shape and would let the
drawer work without a live socket. **Recommend the socket path in this phase**
and the HTTP route as a small follow-up, so the drawer degrades gracefully when
the socket is down.

**UI to build** — none of this exists yet:
- `apps/web/src/components/wallet/WalletDrawer.jsx` — Deposit and Withdraw
  tabs, per the reference: coin picker → QR + address + copy on Deposit;
  coin, amount with a percentage quick-select, destination address, preview,
  confirm on Withdraw.
- Balance chip + currency switcher in `Header.jsx`, driven by the
  currency flags from `site-config/public` intersected with
  `SUPPORTED_CURRENCIES` (`backend/.env`: `USDT,BTC,ETH,LTC,TRX,DOGE,INR`).
- A transactions page over the ledger and history routes.

**Formatting rule:** every balance is a decimal string. Extend
`apps/web/src/lib/format.js` with a string-safe currency formatter — do not
`Number()` a balance for anything but display width.

**Done when:** a demo player sees their real balance, opens the drawer, reads a
deposit address, and a staff-side `POST /api/v1/admin/user/wallet/adjust`
is reflected in the header after a refetch.

### What Phase 4 actually landed

Landed 2026-09-09. The socket transport and the drawer. The transactions page
over `/wallet/ledger` and `/history/*` is **not** built — the endpoints and
hooks are registered and ready for it.

**New:** `lib/socket.js`, `lib/socketEvents.js`, `queries/wallet.js`,
`scripts/verify-socket-events.mjs`, `lib/format.test.js`.
**Modified:** `components/layout/DepositDialog.jsx` (real address panel, real
withdraw form), `auth/AuthProvider.jsx` (session rebinding),
`lib/endpoints.js` (7 wallet paths, 32 total), `lib/format.js`
(`compareDecimal`, `percentOf`), `backend/scripts/seed-data.js` (demo deposit
addresses).

#### Two backend defects, both found by trying it

**`GET_ADDRESS` throws whenever a `chain` is passed.** The handler filters the
`wallets` lookup by `chain` — and `wallets` is `(address, uid, coin, date)`.
**There is no chain column.** Verified against the running service:

    { coin: 'USDT' }                  -> { status: true, address: … }
    { coin: 'USDT', chain: 'TRC20' }  -> SOCKET_HANDLER_FAILED

The 500 is the smaller half. The real problem is that the schema stores **one
address per (uid, coin)**, so a chain cannot be recorded at all — and USDT on
TRC20 is a different address from USDT on ERC20. Money sent to the wrong
chain's address is generally unrecoverable.

So the client does not send `chain`, and — more importantly — the drawer
**refuses to caption a multi-network coin's address with the network the
player selected**. It says outright that the deployment does not record which
chain the address is on. Filling that in client-side would be inventing the
single most dangerous fact on the screen. Fixing it properly needs a migration
adding `chain` to `wallets` plus a unique key on `(uid, coin, chain)`.

**The socket refusal envelope has two shapes, not the one the docs describe.**
`SOCKET-API.md` §4 documents `{status: false, msg, error}`. What the server
actually sends is either:

    { error: { code, message } }                      // transport guard — no `status` key at all
    { status: 'That currency cannot be withdrawn',    // handler refusal — `status` IS the message
      error: { code } }

Both matter. `if (reply.status)` passes on the second, because a non-empty
string is truthy — so a loose check reads every handler refusal as a success.
`request()` treats only `status === true` as success and looks for the message
in both slots.

#### Three things about the transport worth keeping in mind

**The event names are opaque hashes and a typo is silent.** One character
different and the server listens on one string while the client sends another:
no 404, no refusal, no reply. `verify-socket-events.mjs` diffs the client's
table against `backend/packages/socket/src/events.js` byte for byte, because
the backend's own boot-time guard does not protect the client.

The script is `verify:socket-events`, deliberately not `verify:sockets`:
`backend/package.json` already has that name for `tools/socket-inventory.js`,
which diffs against a `legacy/` tree that is absent from this repo and so
reports `0/0` with its own "do not treat this as a pass" warning. Two checks
sharing one name is how a green line gets read as covering something it never
ran — which is exactly what happened once here, from a shell whose working
directory was `backend/`.

**`auth` is a function, not an object.** Socket.io calls it before every
connection attempt including reconnects. `auth: { token }` snapshots the token
at construction, so the first reconnect after a 15-minute rotation would
present an expired one — and the server would accept that connection as
*anonymous*, because a missing or bad token is a signed-out visitor rather than
an error. Every `player` event would then be refused on a connection that looks
perfectly healthy.

**Signing out closes the socket rather than rebinding it.** There is no
`ONLINE_LOGGED_OUT`, and a bound socket left open keeps the previous player's
room subscription alive for whoever uses the browser next.

#### The withdrawal form

It moves real money and takes the account password, so: the password lives in
component state for the duration of the form and nowhere else — not in a query
key, not in the cache; `retry: false`, because a withdrawal is not idempotent
and the server has no request id to deduplicate on; the confirm step shows the
amount and destination back before it emits; and every amount is a decimal
STRING end to end.

That last one needed `compareDecimal` and `percentOf` in `lib/format.js`, both
`BigInt` over digit strings. `Number('123456789012345678.00000001')` equals
`Number('…02')` — a float cannot tell two `NUMERIC(30,8)` balances apart, and
the over-balance check is the one comparison where being quietly wrong hands
out money. `percentOf` truncates, so **Max** asks for exactly the balance
rather than a hundredth more, which the server would refuse.

#### Demo deposit addresses

`GET_ADDRESS` is a plain `SELECT` with no generation path, so without a
`wallets` row the drawer could only ever show its empty state. The `players`
demo set now seeds one address per player for USDT, BTC, ETH and TRX,
prefixed `demo1` so nothing can be mistaken for a live deposit target, and the
seeder warns that money sent to one is lost. `--demo` only.

#### Verification

    npm test                 # 102 unit tests, incl. the decimal arithmetic
    npm run verify:socket-events   # 7 event names, byte for byte
    npm run verify:api       # 48 live checks
    npm run build

Driven in a browser as a signed-in demo player, with a clean console: the
header chip showed the real balance; the drawer's address panel rendered the
seeded USDT address with a 160×160 QR **and** the multi-network warning; BTC
(single network) rendered the address with no warning; DOGE (no row) showed the
honest "no address provisioned" state with no QR; the withdraw form reported
`10,000.00 INR available`, **Max** filled exactly `10000.00`, an over-balance
amount both warned and disabled Review, and the confirm step showed the amount
and destination back with the password field appearing only there.

The withdrawal was **not** submitted — that executes a transfer. Everything up
to the confirm button is verified; the emit itself is not.

The staff-side adjust could not be used either: `POST /admin/user/wallet/adjust`
needs a staff token, and the seeded super-admin is refused at login with
`STAFF_AUTH_TWO_FACTOR_ENROLMENT_REQUIRED` (the same 2FA gate Phase 0 hit). The
equivalent was done directly against `credits`, and the header picked the new
figure up on refetch — `10,000.00` to `12,345.67` and back.

---

## Phase 5 — Play

Goal: `Play.jsx` stops being a placeholder panel.

**Two launch paths, and they are genuinely different:**

*In-house Originals — playable today, no provider account.* The `in-house`
module implements 20 games (`crash`, `plinko`, `limbo`, `mine`, `keno`,
`blackjack`, `roulette`, `classic_dice`, `hilo`, `tower`, …) with
engines that debit, resolve and pay out in one transaction
against the wallet. Each is a `PLAY_*` socket event. `crash` and `keno` are
shared rounds with broadcast phase events (`STATUS_CRASH`, `WAITING_CRASH`,
`BUSTED_CRASH`, `FINISH_CRASH`, `PLAYERS_CRASH`, `HISTORY_CRASH`,
`STATUS_KENO`). Build **one** original first — Plinko or Limbo, the simplest
bet→result→payout shapes — to establish the pattern, and treat the remaining
19 as follow-on work rather than part of this phase.

*Aggregator games — the seam, not the content.* `POST /casino/gis/launch`
(real) and `POST /casino/gis/launch-demo` (fun mode) return a provider launch
URL for an iframe. Both call Slotegrator upstream and will fail without
credentials, so `Play.jsx` must render its existing placeholder frame on a
provider error rather than a crash — that is the state this phase ships in, and
filling `GIS_MERCHANT_ID`/`GIS_MERCHANT_KEY` is what turns it real with no code
change. The Fun/Real buttons already on the page (`Play.jsx` lines 60–64) map
one-to-one onto the two routes.

Also here: `GET /casino/games/recently-played` (the `Recents` rail),
`GET /casino/bet-history` and `/bet-history/stats` (the player's own history),
and `GET /casino/gis/limits`.

**Done when:** one in-house original completes a real round that moves the
balance and writes a ledger row, and an aggregator game shows a clear
"provider not configured" state instead of an error boundary.

### What Phase 5 actually landed

Landed 2026-09-09. Both halves of the "Done when", verified in a browser
against the live platform. The remaining nineteen originals are follow-on
work and the page says so per game rather than in a release note.

**New:** `queries/play.js`, `components/play/LimboGame.jsx`,
`components/play/ProviderFrame.jsx`, `lib/socket.test.js`.
**Modified:** `lib/socket.js` (two connections, second envelope),
`lib/socketEvents.js` (`PLAY_LIMBO`, `SERVICE_OF`), `lib/endpoints.js`
(`gisLaunch`, `gisLaunchDemo`, `betHistory` — 35 paths), `pages/Play.jsx`
(three frames), `hooks/useWallet.js` (`refreshBalances`), `queries/wallet.js`,
`queries/keys.js`, `vite.config.js` (`/casino-socket`),
`scripts/verify-api-contract.mjs` (4 checks, 51 total).
**Backend:** `in-house/engine/gameEngine.js` (the settle fix),
`packages/common/src/money.js` (a note), `in-house/__tests__/inHouse.test.js`
(a regression test).

#### Two things about the transport that Phase 4 could not have known

**The in-house events are on a DIFFERENT SERVER.** casino-service holds its
own Socket.io server because a round is a stake debit, a result and a payout
in one transaction on `bets`, `credits` and `house` — casino tables that
user-service does not load. Routing that through an internal HTTP hop would
put a network call inside the transaction that has to be atomic, which is
what legacy had and what the engine exists to fix.

The gateway cannot help: `gateway/src/proxy.js` strips `upgrade` with the
other hop-by-hop headers, so a websocket handshake sent at :4000 never
reaches a service. And both servers listen on Socket.io's default
`/socket.io`, so they cannot both be same-origin under one path. The answer
is a second Vite entry that rewrites `/casino-socket` back to `/socket.io` on
:4003, and `VITE_CASINO_SOCKET_URL` for a deployment that gives casino a host
of its own. `SERVICE_OF` in `socketEvents.js` routes each event from the
table, so a caller passing `EVENTS.PLAY_LIMBO` never has to know any of this.

**`ONLINE_LOGGED` does not exist on casino-service**, because it is
registered by user-service's `auth` socket module and casino registers only
`in-house`. So a player who signs in without reloading cannot have their
casino socket *rebound* — it is closed and reopened instead, which does the
same job because the `auth` callback re-reads the token on every attempt. A
casino socket left anonymous refuses every `PLAY_*` for as long as it stays
open, and presents as a Bet button that does nothing.

#### And a second reply envelope, which is the sharper edge

`createSocketServer` does not wrap a handler's return value — it replies with
exactly what the handler produced. Every user-service module wraps its own
(`const ok = (payload) => ({status: true, ...payload})`). **The `in-house`
module never did.** It answers legacy's `command` envelope:

    { command: 'busted', target, result, hash, profit, balance, win, gid }
    { command: 'play',   hash, roundId, balance }
    { command: 'error',  message, code }          // INHOUSE_* refusal

No `status` key on any of them. `request()` treats anything but
`status === true` as a refusal, so it rejects a **won round** with
`code: 'SOCKET_ERROR'` and no message — the failure runs in the worst
direction, and it is silent. `play()` is the second reader; the choice
between them is made per event rather than guessed from the reply, and
`lib/socket.test.js` pins both shapes plus the one that would regress.

Transport-guard refusals (`{error: {code, message}}` — unauthenticated, rate
limited, handler threw) are identical on both paths, because they come from
the framework rather than from a module.

#### A backend defect: winning rounds were voided

Found by playing `10 @ 1.01` against the running service. Three attempts,
three refusals:

    { error: { code: 'BAD_REQUEST',
               message: 'amount supports at most 8 decimal places' } }

Every in-house game computes its profit in JS floats — the arithmetic was
ported as-is — and hands it over as `String(profit)`. Limbo's is
`stake * target - stake`:

    10 * 1.01 - 10  ->  0.09999999999999964     (17 places)
    10 * 3.33 - 10  ->  23.299999999999997      (15 places)
    10 * 2.00 - 10  ->  10                      (exact)

`GameEngine.settle` parsed that with `money.toMinor`, which refuses more than
the platform's `NUMERIC(30,8)` scale — correctly, for a request body — and
**threw inside the settlement**. The handler's catch refunds the stake and
re-raises, so no money was lost, but the WIN paid nothing and the player got
a message about decimal places. Deterministic per (stake, payout) pair, not
intermittent: `10 @ 1.01` never paid, `10 @ 2.00` always did. All twenty
games have the same `String(<float>)` shape.

The fix is one line at the one place a float artefact can still be corrected
before it becomes money: `settle` quantises the PROFIT with
`money.toMinorQuantised` while the stake keeps `toMinor`, because the stake is
`placeBet`'s own exact output and the profit is not. Quantising is the more
correct number here — 10 × 1.01 − 10 *is* 0.1 in decimal, and the trailing
digits are the float's error. Verified: `profit 0.10000000`, `23.30000000`.

#### And a front-end one, of the same silent shape

`invalidateQueries({queryKey: ['balances']})` — in the wallet's withdrawal
mutation since Phase 4 — **matched nothing**. `useBalances` is a hand-rolled
`useEffect` fetch rather than a React Query hook, so it holds no cache entry
for that key, and an invalidation that hits zero queries is not an error.
Found in the browser: the Limbo panel repainted with the round's new balance
while the header chip two inches above it still showed the old one.
`refreshBalances()` in `hooks/useWallet.js` is a counter every mounted
`useBalances` subscribes to; both call sites use it now.

#### The hash is NOT offered as a fairness proof

`in-house/engine/hash.js` says it plainly, and the UI follows: `makeHash()`
takes no player input and is drawn at the same moment as the result rather
than published beforehand, so there is no commitment to verify against, and
its seed is `Math.random()`. The panel labels the value as the round's
identifier — which is what `bets.hash` is and what a support ticket names —
and nothing more. This doc said "provably-fair engines" above; that was
wrong, and it is corrected.

For the same reason the panel prints a **multiplier curve**, not a win
chance. `GameEngine.canProfit` reads the `house` table before every round,
and when the house is over its configured maximum Limbo re-rolls any result
that would have beaten the player's target until one does not. Nothing on the
wire tells this client whether that is in force, so a probability would be a
claim we cannot support.

#### Verification

    npm test                       # 111 unit tests (9 new, on the two envelopes)
    npm run verify:socket-events   # 8 event names, byte for byte
    npm run verify:api             # 51 live checks (4 new)
    npm run build
    cd backend && npm test         # 1272/1273 — the one failure is `packages/socket`,
                                   # which requires a `legacy/` tree absent from this repo

Driven in a browser as `demo_player01` with a clean console:

- **Limbo** — balance 10,031.90 INR in the header and in the stake field's
  hint; `Bet` on `10 @ 2.00` rolled **2.33×**, won 10.00 INR, balance
  10,041.70 (stake back less the 2% edge, plus the profit), round #19 with
  its hash. `Your recent rounds` then read the same round back out of
  `GET /casino/bet-history?source=inhouse` — the socket reply and the
  database agreeing a moment apart.
- **The header chip** — stale after the first round (the defect above), then
  correct: a second round paid 10.00 and the chip moved 10,041.70 →
  10,051.50 on the same frame as the panel.
- **An aggregator title** (`sunken-vault`) — `Real mode` rendered
  **"Provider not configured"** with `GIS_NOT_CONFIGURED` under it, in the
  frame, with no error boundary.
- **An unwired original** (`mine`) — "This original runs on the platform
  already. The client for it is not built yet."

Not exercised: `POST /gis/launch` past its 503, which needs credentials this
deployment does not have; and the nineteen other originals.

---

## Phase 6 — Account area

Goal: the avatar menu leads somewhere. New routes under `/account/*` in
`App.jsx`, all behind `RequireAuth`.

| Screen | Routes |
| --- | --- |
| Profile | `GET`/`PUT /api/v1/user/profile` |
| Preferences | `GET`/`PATCH /api/v1/user/preferences` |
| Security — 2FA | `GET /2fa/status`, `POST /2fa/enable`, `/setup-verify`, `/verify`, `/disable` |
| Security — sessions | `GET /auth/sessions`, `POST /auth/logout {allSessions}` |
| KYC | `GET /kyc/status`, `POST /kyc/submit` (multipart, one file, ≤4 MB, PNG/JPEG/WebP by magic bytes — **SVG is refused**) |
| Transactions | `GET /user/history`, `/history/deposits`, `/history/withdrawals`, `/history/transfers` |
| Vault | `GET /vault`, `/vault/lock-options`, `/vault/transactions`, `POST /vault/transfer-in`, `/transfer-out` |
| Bonuses | `GET /bonus`, `/bonus/history`, `POST /bonus/claim/:type`, `/bonus/redeem` |
| Rakeback | `GET /rakeback`, `POST /rakeback/claim` |
| Wager progress | `GET /user/wager/progress` |
| Referrals / affiliate | `GET /affiliate`, `/affiliate/rewards`, `POST /affiliate/rewards/claim` |
| Gift cards | `GET /gift-cards`, `POST /gift-cards/claim` |
| Bank details | `GET /bank-details/:coin_type` |

**Done when:** every item in the account menu renders real data and the
mutating ones round-trip.

### What Phase 6 actually landed

Landed 2026-09-09, verified in a browser against the live platform.

**First, this table was written before the account area existed.** It says
"new routes under `/account/*`"; the pages have lived under `/profile/*`
since well before this phase, which is the reference's own URL scheme, and
they stay there. Three of its rows were already real from Phase 3 — Profile
(`GET`/`PUT /user/profile`), Preferences (`GET`/`PATCH /user/preferences`)
and Referrals (`/affiliate/team`, `/affiliate/rewards`). What was actually
outstanding is what `docs/09` named: **2FA, KYC upload and transactions**,
plus **sessions** from this table's own Security row. That is this tranche.

**New:** `queries/account.js`, `queries/account.test.jsx`,
`components/ui/Dialog.jsx`, `components/ui/PasswordField.jsx`,
`components/account/KycDialog.jsx`, `pages/Transactions.jsx`.
**Modified:** `lib/api.js` (multipart), `lib/endpoints.js` (7 paths — 42
total), `pages/Security.jsx` (real 2FA, a sessions card), `pages/Account.jsx`
(the KYC button), `hooks/useProfile.js` (`useKyc` removed),
`components/ui/Switch.jsx`, `pages/ProfileLayout.jsx`, `App.jsx`,
`queries/{keys,index}.js`, `scripts/verify-api-contract.mjs` (7 checks, 56
total).

#### The plan's KYC row was wrong on every count

It says "multipart, one file, ≤4 MB, PNG/JPEG/WebP by magic bytes". Read from
`kyc.constants.js`, the route takes **up to three** files (`idFront`,
`idBack`, `passport`), the ceiling is **5 MB** each (`MAX_FILE_BYTES`), and
the accepted types are JPEG, PNG and **PDF** — no WebP. The magic-bytes check
is real and is the part that matters: uploads are held in memory until the
first bytes are verified, so a refused file never touches the filesystem.

The form asks for the slots the chosen document actually has — a passport is
one page, an ID card and a licence have two sides — rather than showing three
and letting the player guess which to ignore.

#### The multipart content-type is the trap, and it fails as a 500

`api.js` now detects a `FormData` body and sends **no content-type header**,
because only the browser knows the boundary it generated. Measured against
the running service with the same body:

    with `content-type: multipart/form-data`  ->  500 INTERNAL_ERROR
                                                  "Something went wrong"
    with no content-type at all               ->  201 {id, status: 'Pending'}

The 500 is the point. It carries no field detail and no hint that the request
never reached the validator, so it reads as a broken endpoint rather than a
malformed request — somebody debugging it goes looking at the route. Pinned
by a test.

#### Two-factor is a three-step handshake, and step one is not idempotent

`POST /2fa/enable` mints a **new** secret and overwrites the stored one every
time it is called. A second call after the player has scanned the first QR
leaves their authenticator showing codes for a secret the server has already
discarded — every code is then correct in their app and wrong here, with
nothing on screen to explain it. So the setup dialog fires it **once** from
the effect on open and holds the answer in mutation state: not a query, which
would refetch on focus, on remount and on invalidation, each of those a fresh
secret. `retry: false` for the same reason, also pinned by a test.

`GET /2fa/status` answers `{isEnabled, hasInitiated}`, which is **three**
states rather than two. The middle one — a secret minted and never confirmed
— is what an abandoned setup leaves behind, and the card says so plainly
instead of reading "Inactive" at somebody whose app is already showing codes.
The state comes from this route rather than `/auth/me`'s `two_fa_status`,
which cannot express it.

Disabling takes the code **and** the password, and `twofa.service.js` checks
the password first, so `TWOFA_PASSWORD_REQUIRED` lands on the password field
and the code field is left alone. Disabling also *clears* the secret rather
than flagging it off, so re-enabling issues a new QR and the old entry in the
app is dead — the dialog says that before the player presses the button.

#### A sessions card the reference does not have

`bitcasino.io/profile/security` has two cards and no session list. This build
adds a third: the sessions are real, and an account page that can change a
password but cannot show where the account is signed in is missing the half
of the story that matters after a password is stolen. Recorded in `docs/11`
as a deliberate divergence, as is the tenth tab (`Transactions`) in
`ProfileLayout`.

There is **no per-session revoke route** — `POST /auth/logout` takes a
`refreshToken` for one or `{allSessions: true}` for all, and nothing addresses
a session by id — so the card offers "sign out everywhere" and does not draw
a per-row button that could not work. The current session is not marked
either: the list carries no id the client can match its own token against,
and guessing from the user-agent would mark every tab in the same browser.

#### `useKyc` moved to the query layer, to avoid a bug this repo has hit twice

`useSubmitKyc` invalidates the status read. `useKyc` in `hooks/useProfile.js`
was a hand-rolled `useEffect` fetch holding nothing in the query cache, so
that invalidation would have matched **zero queries and done nothing** —
silently, because an invalidation that hits no query is not an error. The
identity card would have gone on advertising "Start verification" for
documents already in the review queue.

That is the same defect Phase 5 found between `usePlayRound` and
`useBalances`, and the same one that was sitting dead in the withdrawal
mutation since Phase 4. Rather than add a third refresh signal, the read moved
onto the query layer where the mutation beside it can reach it. `useProfile`
and `usePreferences` stay as they are: neither has a mutation reaching into a
cache, so there is nothing to fix and a rewrite would be churn.

#### A deployment gap the transactions table has to be honest about

`CCPAYMENT_COIN_IDS` is unset in `backend/.env`, so `ccpaymentTicker` cannot
resolve a crypto deposit's numeric `coinid` and the service falls back to
`String(coinId)`. Rows arrive with `currency: "1280"`. Printing that beside
the amount reads as part of the number; guessing USDT would be a claim about
which asset moved, made from no information. The table draws it as
`coin #1280` with a title naming the variable to set.

#### Not built, and named rather than quietly skipped

Vault, bonuses, rakeback, wager progress, gift cards and bank details. All six
have live routes — probed and answering — but each is a screen of its own, and
the Rewards page they would feed still runs on `data/rewards.js`. Notifications
runs on `data/notifications.js` for the reason Phase 4 recorded: there is no
player notification feed in user-service. Those are the next tranche, not
this one.

#### Verification

    npm test                       # 116 unit tests (5 new)
    npm run verify:api             # 56 live checks (7 new)
    npm run verify:socket-events
    npm run build
    cd backend && node tools/verify-frontend-routes.js   # 42/42 endpoints mount

Scripted against the live platform, the full two-factor lifecycle:

    1. status before          {isEnabled: false, hasInitiated: false}
    2. enable ->              200  secret + QR data URL
    3. status mid-setup       {isEnabled: false, hasInitiated: true}
    4. wrong code ->          401  TWOFA_INVALID_CODE
    5. real code ->           200  {enabled: true}
    6. status after enable    {isEnabled: true, hasInitiated: true}
    7. disable, bad password  401  TWOFA_PASSWORD_REQUIRED
    8. disable ->             200  {enabled: false}
    9. status after disable   {isEnabled: false, hasInitiated: false}

Driven in a browser as `demo_player01` and `demo_player03`, clean console:

- **Two-factor** — the toggle opened a live `POST /2fa/enable` with a real QR
  and the base32 key; a TOTP computed from that key turned it on and the card
  behind the dialog repainted to `Active` before the dialog closed. Turning it
  off with a wrong password put `TWOFA_PASSWORD_REQUIRED` on the password
  field and left the code field clean; the correct pair closed the dialog and
  the card read `Inactive`.
- **Sessions** — `Chrome on Windows · 127.0.0.1 · last used just now`, live.
- **Transactions** — three tabs; deposits and withdrawals rendered seeded rows
  with per-currency precision (`75.50 USDT`, `500.00000000 BTC`), normalised
  status pills, and `coin #1280` for the unresolved ticker. Transfers showed
  its own empty state. One layout bug found and fixed here: the header row
  lacked the cells' `pe-3` and printed "AmountStatus".
- **KYC** — `Start verification` opened the form; an under-18 date and a
  missing file were both refused client-side with no request sent; a 1990 date
  and an attached PNG submitted, the dialog showed `Pending`, and the identity
  card behind it had already flipped to "Under review". `Pending` renders no
  submit button, because a second submission queues the same review twice.

Not exercised: a `Rejected` KYC state (needs a staff decision, and staff login
is still blocked by the 2FA enrolment gate Phase 0 hit), and the six unbuilt
account screens above.

---

## Phase 7 — Content, promotions and site config

Goal: the marketing routes stubbed to `Navigate to="/"` in `App.jsx` become
pages backed by the admin content modules.

- **Home banners** — `GET /api/v1/admin/banners` and `/banners/:type` (public
  audience on admin-service). Images are served from
  `/api/v1/admin/banners/image/:filename` with the **detected** content type;
  they live in the row as `BYTEA`, not on disk. Replaces the hand-written
  `HOME_BANNERS` in `catalog.js` and feeds the new `HomeBanner.jsx`.
- **Blog / Help Centre** — `GET /api/v1/admin/blogs` (page-based),
  `/blogs/slug/:slug`, `/blogs/category/:category`, `/blogs/:id/image`.
- **Promotions / Tournaments / VIP** — composed from `bonus` events
  (`GET /user/bonus/events`), `spin-wheel` (`GET /spin-wheel/slices` is public,
  `/eligibility` and `POST /spin-wheel/spin` are player), and banners.
- **Referral landing** — `GET /api/v1/admin/locks/ref/:slug` resolves a
  referral slug for `/register?ref=`.
- **Footer and legal** — payment-method list and licence blocks driven by the
  currency flags from `site-config/public`; the legal pages stay static.
- **Rate ticker** — the `1 USDT = 94.558 INR` line in the reference footer.

**Done when:** `/promotions`, `/tournaments`, `/vip` and `/blog` are real pages
and no `Navigate to="/"` stub remains except the intentional ones.

---

### What Phase 7 actually landed

Landed 2026-09-09. Re-audited 2026-09-10 against the running platform, which
is where the `/bonus/events` defect below came from — the pages were built and
shipped before anyone checked what that route returns.

**New:** `queries/content.js`, `queries/promotions.js`, `pages/Blog.jsx`,
`pages/BlogPost.jsx`, `pages/Promotions.jsx`, `pages/Vip.jsx`, and the tests
`queries/content.test.jsx` and `queries/promotions.test.jsx`.
**Modified:** `lib/endpoints.js` (eleven content and promotion paths),
`components/sections/HomeBanner.jsx` (platform art), `App.jsx` (four routes
stop redirecting), `components/layout/Footer.jsx` (a real rate pair),
`queries/{keys,index}.js`, `scripts/verify-api-contract.mjs`.

`/promotions`, `/tournaments`, `/vip` and `/blog` are pages rather than
redirects. The only `Navigate to="/"` left in `App.jsx` is `testimonials`,
which is the intentional one this phase's "Done when" allows for: on the
reference it is a SECTION of the home page, already rendered there, so a route
for it would be a second copy of a block on the page it redirects to.

#### `GET /user/bonus/events` is the player's own bonus log

This is the one real defect in the phase, and it is worth the space because of
how it hid.

The bullet above reads the route as the operator's scheduled promotions.
`bonus.service.js#myEvents` is `Bonushistory.findAndCountAll({where: {userid}})`
— the caller's own log of bonuses already PAID, shaped
`{id, userId, event, amount, createdAt, updatedAt}`. There is no title, no
description and no window on it, and **there is no scheduled-promotions table
on this platform at all**: no `bonus_events`, no tournaments table, nothing an
operator fills with a promotion that has a start and an end.

`Promotions.jsx` was built on the bullet's reading. It rendered a "Running
now" panel over `{name, description, startDate, endDate}` — four fields the
row does not have — with an empty state reading "No promotions are scheduled
at the moment."

It looked correct in a browser and passed the live contract check, because
`bonushistory` is **empty** on this deployment. The empty state was the only
branch anyone ever saw. One paid bonus would have produced a list of headings
reading "Promotion" over blank date ranges — `undefined` renders as nothing,
so it would have looked like a styling bug rather than a wrong route.

Now: the panel is `Your bonuses`, over the fields the row actually has, and the
missing platform surface is stated on the page instead of implied by an
optimistic empty state. `promotions.test.jsx` puts a row in, which is the only
condition under which the two readings differ.

#### The banner bullet is wrong too, in a way that cannot be fixed here

It says `GET /api/v1/admin/banners` "replaces the hand-written `HOME_BANNERS`
in `catalog.js`". It cannot. The row is:

    (id, type, image, content_type, byte_size, uploaded_by, is_active, …)

An image and a placement name. **No title, no blurb and no destination**, and
each of the three home cards has all three. So `HomeBanner.jsx` takes the split
the data supports — art from the platform when a placement has one, copy and
link local — and says so at the top of the file. `banner.id` is the placement
key, so uploading a banner of type `banner-league` swaps the League card's
artwork with no code change, which is the part an operator actually wants.

Giving the platform the copy as well means a migration adding `title`,
`subtitle` and `href` to `banners` plus the admin-panel fields for them:
backend work, named here rather than faked in the component. The table is
empty on this deployment, which is the normal state where nobody has uploaded
anything, so the fixture art renders and nothing is wrong.

#### `description` is the body and `subheading` is the standfirst

The blog row names its two text columns almost exactly the wrong way round. A
component reading them as the names suggest would print the standfirst as the
article and the article as a subtitle, and both would look plausible enough to
ship. `toPost` in `queries/content.js` is the one place that mapping happens,
and `content.test.jsx` pins it.

The index ships **no body at all** — `description` is absent on every row of
`GET /admin/blogs`, and only the two detail routes carry it. A detail page that
filtered the list instead of fetching by slug would render an empty article
with no error anywhere.

#### The post body is rendered as text, never as HTML

`blogs.description` is a plain text column. Nothing on the platform declares it
as HTML or Markdown, nothing sanitises it on the way in, and the admin panel
that writes it is not in this repository. `BlogPost.jsx` splits it on blank
lines and renders paragraphs.

Not caution for its own sake: the column is operator-supplied and reaches the
page over a **public** route, so `dangerouslySetInnerHTML` would let any staff
account with `config:write` — or anything that ever compromises one — run
script in every visitor's session, on a page a signed-in player loads with a
live token in memory.

#### The blog's category chips describe the page, not the archive

`blogs.category` is free text an operator types, not an enum, so there is no
canonical list to build chips from and an unknown category answers an empty
list rather than a 422. The chips are built from the categories the fetched
page contains. With three seeded posts on one page that is the whole archive;
the two diverge once there are more posts than a page holds, which is where the
platform needs a "list the categories" route it does not have.

#### `eligible` and `claimable` are different things, and collapsing them lies

`GET /user/bonus` reports both on each of the three periodic bonuses.
`eligible` is whether the account's VIP level has reached the bonus's
`minVipLevel`; `claimable` is whether there is something to take right now.

A player at level 0 looking at a daily bonus with `minVipLevel: 20` is not "not
claimable yet" in the sense of "come back tomorrow" — they are twenty levels
away, and the two sentences send them somewhere completely different.
`Vip.jsx` branches on both.

The page does **not** restate `/loyalty`'s seven-tier benefits ladder. The
platform reports a level number, a card name and a wager target, and nothing
about what a level is worth; the ladder is this project's own model, so the
page reports the real standing and links there rather than presenting an
invented benefits table as though the platform had confirmed it.

#### The spin wheel is three routes with three audiences, and no money moves

`GET /spin-wheel/slices` is public — a visitor may see the prizes before
signing up, which is the entire point of a wheel on a marketing page.
`/eligibility` and `POST /spin` are player-scoped. The public route omits
`weight` on every slice and `verify:api` asserts it stays omitted: the weights
are the odds, and a client holding them could compute the house edge off the
shape of the wheel.

The reply to a spin is `{slice, isBadLuck, redeemCode, rewardPct}` — a
percentage applied to the player's NEXT deposit and a code to redeem it with.
The service says so at the return. A screen announcing "you won 20%" as a
credit would be describing a different feature.

#### The referral landing resolves at submit, not on arrival

The plan's row is `GET /api/v1/admin/locks/ref/:slug`. `/ref/:code` is a
redirect to `/register?ref=…`, and the code is resolved by
`GET /user/profile/verify-referral/:referralCode` when the form submits — the
route wired in Phase 3, and the one whose answer the register call actually
depends on. Resolving it twice would put two sources of truth behind one
number.

#### Not built, and named rather than quietly skipped

- **Tournaments still reads a fixture.** `/tournaments` and
  `/tournaments/all/:filter` are real pages over `data/tournaments.js`, and
  that is where they stay: there is no tournaments table on this platform and
  no route that lists one. The plan's "composed from `bonus` events" does not
  survive the finding above — the events route is a personal bonus log. Wiring
  it would need a backend feature, not a front-end change.
- **A help centre.** The footer links fourteen `/help-center/*` paths and none
  of them is a route, so each lands on the 404. The blog is the surface that
  could back them — `blogs/category/Policy` already holds `responsible-gaming`
  — and mapping the two is a small piece of work that is **not** in this phase.
  `docs/11` records the same gap from the Boosts page's side.
- **A per-promotion detail page.** Nothing behind a promotion slug exists, so
  `/promotions/:slug` redirects to the index rather than fabricating a page.
  One route to delete when the platform grows a detail read.
- **A tournament detail page and an `Opt in` that posts**, for the same reason
  — the cards' arrows do not link anywhere.

#### Verification

`npm run verify:api` covers the content and promotion reads: the blog index
and a detail read, that the index carries no body, the banner list, the spin
wheel's segments and its withheld weights, and that all three player-scoped
promotion routes refuse an anonymous caller. `npm test` covers the adapters
behind them, including the corrected bonus-log mapping.

---

## Phase 8 — Live surfaces, hardening, CI

- **Live wins ticker** — `LAST_BETS`, `LAST_BETS_BY_GAME`, `TOP_WINNERS`
  (all public socket events) plus `GET /casino/bet-history/live`.
- **Chat** — `CHATS` (public), `ADD_CHAT` (player, broadcast, 20/min),
  `MY_FRIENDS`, `MESSAGES`. A signed-in socket joins `user:<id>`, so a player
  with two devices gets private pushes on both.
- **Notifications** — `NOTIFICATION` (public), `admin_notify` broadcast. Note
  it emits `{mesage: …}` — one `s`. That typo **is** the wire protocol; the
  correct spelling is sent alongside, so read both.
- **Rate limits.** Sockets are metered per connection per event (public 40/10s,
  player 120/10s); HTTP has its own buckets. Handle `SOCKET_RATE_LIMITED` and
  the HTTP 429 with backoff rather than a retry loop.
- **Error boundaries and empty states** on every route; `requestId` surfaced.
- **Tests.** There are none in `apps/web`. Vitest + Testing Library for the
  adapters, the token store's single-flight refresh, and the socket
  encode/decode wrapper; Playwright for register → log in → view balance →
  play an original.
- **ESLint flat config** — `npm run lint` is wired but no config exists.
- **CI wiring** — `node tools/verify-frontend-routes.js` (with the web registry
  added in Phase 1), `npm run verify:modules`, `npm run db:verify`.

---

### What Phase 8 actually landed

Landed 2026-09-10. Six of the eight bullets above; chat and Playwright are not
built and are named at the end rather than left to be discovered.

**New:** `apps/web/eslint.config.js`, `queries/live.js`,
`components/layout/ErrorBoundary.jsx`, `components/play/RecentRounds.jsx`,
`.github/workflows/ci.yml`, and four test files — `lib/rateLimit.test.js`,
`queries/live.test.jsx`, `queries/promotions.test.jsx`,
`components/layout/ErrorBoundary.test.jsx`.
**Modified:** `lib/api.js` (`retryAfter`), `lib/socket.js` (`isRateLimited`,
`RATE_LIMIT_WINDOW_MS`), `lib/socketEvents.js` (four public events — twelve
total), `lib/endpoints.js` (one path removed), `queries/client.js` (429
backoff), `queries/keys.js`, `queries/index.js`,
`components/ui/QueryState.jsx` (the rate-limit message),
`components/sections/LatestWins.jsx` (rewritten), `components/sections/Rail.jsx`
(an optional header action), `components/layout/Layout.jsx`, `main.jsx`,
`hooks/useNotifications.js` (a real feed), `pages/Notifications.jsx`,
`pages/Play.jsx`, `scripts/verify-api-contract.mjs` (a socket section).
**Deleted:** `data/notifications.js`.
**Backend:** `services/user/src/modules/profile/sockets.js` (one line — see
below), `scripts/seed-data.js` (three notices in the `content` demo set).

Tests: **168**, up from 126. `npm run lint` runs green for the first time.

#### A backend defect: the notification feed had never worked

`C.NOTIFICATION` answered `SOCKET_HANDLER_FAILED` to every caller, always.

    on(EVENTS.NOTIFICATION, { audience: PUBLIC, handle: async () => {
      const rows = await models.Notifications.findAll({
        order: [['id', 'DESC']], limit: 20, raw: true,
      });

`notifications` is one of the baseline tables declared with **no primary
key** — `(title, content, date)` and nothing else — and the model says so, in
a comment, right above a `removeAttribute('id')` call. So the query emitted
`ORDER BY "Notifications"."id" DESC` against a column that does not exist,
Postgres refused the statement, and the framework's catch turned the throw
into a generic refusal. Ordering by `date` is the fix.

Found by calling it. The web client's feed is the first thing on this platform
to send that event, which is also why the front end's own
`data/notifications.js` carried a comment claiming user-service had no feed
route: the fixture was written against an event that could not have worked, so
the author reasonably concluded it was not there.

The event is now real, `useNotifications` reads it, and the fixture is deleted.
`scripts/seed-data.js`'s `content` demo set posts three notices, staggered
across eleven days so the page's date column means something.

#### A notification row has no id, so the read set derives one

`Mark all as read` stores the ids it has marked, in `localStorage`, and that
only survives a reload if a row's identity does. With no primary key on the
table the identity has to come from the content: `queries/live.js` derives
`date|title`.

The consequences are stated rather than discovered. An operator who edits a
notice's title changes its identity, so it comes back unread; two notices
posted at the same instant under the same title collapse to one. Both beat the
alternative — a key derived from the row's POSITION, which changes whenever
anything is posted and would mark the whole feed unread every time.

#### The ticker moved to the socket, and dropped an HTTP route to do it

`LatestWins` polled `GET /casino/bet-history/live`. It now reads `LAST_BETS`
and `TOP_WINNERS`, and `GET /casino/bet-history/live` is **gone from
`lib/endpoints.js`**.

The socket rows carry the PLAYER — `{name, avatar, game, coin, amount, profit,
at}`. The HTTP route carries `{reference, game, currency, amount, profit,
outcome}` and deliberately exposes no identity, because it is reachable by
anyone with a URL. A wins strip without a name on it is a list of numbers, and
the reference's own ticker is built around the name. The two are not one read
in two transports; they are a public feed and a more public one.

Nothing calls the HTTP route now, so it is not registered: a path in
`endpoints.js` that no call site sends is a contract check that verifies
nothing. The cost, stated because it is real: a signed-out visitor loading the
home page now opens a socket to user-service, which before this phase they did
not. One connection, shared by every live surface on the page.

`Latest` and `Biggest` are two events rather than one list sorted twice. Each
is twenty rows off a much longer table, so the biggest win of the day is very
unlikely to be among the twenty most recent — sorting the recent twenty by
profit would produce "the best of the last few minutes" under a heading that
claims otherwise.

#### `LAST_BETS_BY_GAME` refuses an empty name and not an unknown one

Measured, because the boundary is not where it looks:

    {game: 'limbo'}       {status: true, game, bets: [...]}
    {game: 'not-a-game'}  {status: true, game, bets: []}      ← a LIST
    {game: ''} / {}       {status: false, error: PROFILE_NOT_FOUND}

Only the empty string is guarded; anything else is passed to casino-service,
which has no such game and no rows for it. So sending a provider title's slug
produces a permanently empty feed with nothing anywhere saying the name was
wrong. `RecentRounds` therefore renders only for a game `isPlayable` has
already vouched for, and `verify:api` pins both halves of the boundary.

It shows losses as well as wins, which the home ticker does not. Same event,
opposite filter: a lobby strip of strangers' losses is bleak, and a table of
nothing but wins beside a Play button is a claim about the game.

#### Rate limits: the wait is reported, and nothing retries in the transport

The two transports refuse differently and the difference is load-bearing.

**HTTP** answers `429 TOO_MANY_REQUESTS` with the wait twice over — a
`Retry-After` header and `details.retryAfter` — and both are the whole window
rather than the remainder. `ApiError` lifts it to `retryAfter`, preferring the
header (an intermediary in front of the platform sets that one) and reading
its HTTP-date form as well as its integer form. `api.js` does not retry:
every attempt inside the window is itself counted, so a client that retries
immediately extends its own lockout. `queries/client.js` allows exactly ONE
more attempt and waits `retryAfter` before it, capped at 30s so a long window
does not hide the error state behind a spinner.

**The socket** sends `SOCKET_RATE_LIMITED` and nothing else — no header, no
remaining time — so a caller cannot know whether it is one second or nine into
the window. Inventing a countdown there would be a number with no source. What
the window's shape gives instead is a safe answer: every bucket in
`DEFAULT_LIMITS` is a fixed 10 seconds, so `RATE_LIMIT_WINDOW_MS` is exported
and the live polls widen their interval to it after a refusal, dropping back to
normal the moment one succeeds.

`QueryError` says which of the two happened. The platform's own copy — "Too
many requests, please slow down" — reads as a scolding and gives no idea
whether to wait two seconds or an hour, and the buckets vary by three orders of
magnitude, so the number is the only part that helps.

#### Error boundaries, and why one is not enough

A failed REQUEST is a state, drawn by `QueryState` beside a page that still
works. What the boundary catches is the other kind: a component that threw
while rendering. Without one React unmounts the whole tree — the page goes
white with the reason only in the console, and on a site whose header carries
the balance and the deposit button, a blank page is indistinguishable from an
outage.

There are two. `Layout` wraps the routed outlet, so a page that throws leaves
the shell — header, sidebar, footer — intact and navigable. `main.jsx` wraps
everything, for what the routed one cannot reach: the auth screens, which
render outside `Layout`, and `AuthProvider` and the router themselves.

The routed one is **re-keyed on the pathname**, and that is the part worth
guarding. React never clears a boundary's error state on its own, so without
the key a single broken page poisons the rest of the session: the player
presses Home, the URL changes, and the same apology stays on screen. It looks
like a site-wide outage and it is one page. `ErrorBoundary.test.jsx` renders
two locations in sequence to pin it.

#### ESLint: two rules, not a style guide

`npm run lint` had been wired since the first commit with no config behind it
— `eslint .` with no config is an error, so the script had never once run
green.

The config is `@eslint/js`'s recommended set plus `rules-of-hooks` and
`exhaustive-deps`, and deliberately no formatting rules: this repository's
formatting is already consistent, and a linter that argues about quotes drowns
the two rules that catch defects. `react/jsx-uses-vars` is the third, and it is
not optional — core ESLint does not know that `<Button />` reads the `Button`
binding, so without it every component imported for JSX is reported unused.
That was 300+ false findings on the first run, which is a linter nobody runs
twice.

Two of `eslint-plugin-react-hooks` v6's compiler-era rules are **off**, in one
place with the reason attached rather than as seventeen inline disables.
`set-state-in-effect` is almost entirely one pattern — a dialog resetting its
fields when it opens — where the rule's advice does not apply: the fields are
edited after the reset so they cannot be derived, and remounting on a `key`
would throw away the exit animation. `purity` fires on `Date.now()` inside
`KycDialog`'s `validate()`, a function called from the submit handler and never
during render.

Eight real findings came out of the first green run: an unused import and an
unused constant in `Security.jsx`, an ignored prop in `DepositDialog`, a
disable directive for a rule this config does not define, two stale directives
in `countries.js`, and a `let carry = 0n` in `format.js`'s `percentOf` that was
declared, added, and never assigned anything but zero.

#### CI runs the front end and skips the seam loudly

`.github/workflows/ci.yml` has two jobs. `web` is lint, unit tests and a
production build; it needs nothing but this repository.

`contracts` is the seam — `verify:socket-events`, `verify:modules`,
`verify-frontend-routes`, and `db:verify` against a Postgres service. Every one
of them reads `backend/`, which is **a vendored tree that is not committed to
this repository** (`git ls-files backend` is empty). On a fresh clone the
directory is not there.

So the job detects it and skips with a message in the run summary — rather than
failing, and rather than passing. A green tick for a check that never ran is
the failure mode worth designing against: it is how a broken contract ships
under a clean build. The moment the backend is available, the job runs with no
edit to the workflow.

`verify:api` is **not** in CI, and it is the most valuable check in the
repository. It needs five processes, a migrated database and a seeded
catalogue; that is a fixture job, not a step. `backend/npm test` — 1095 tests —
is out for the same reason plus one more: it wants its own `ibitplay_test`
database, and the workflow's service container hosts the development one that
`db:verify` migrates. Both are named at the foot of the workflow.

#### Not built, and named rather than quietly skipped

- **Chat.** `CHATS`, `ADD_CHAT`, `MY_FRIENDS` and `MESSAGES` are all
  implemented on the platform and none of them is wired. The reference site has
  no chat surface — no sidebar panel, no drawer, nothing in the header — so
  building one would not be porting a feature but inventing one, and it would
  be the largest surface in the app with nothing to measure it against.
  `ADD_CHAT` also broadcasts to every connected client at 20 messages a minute
  per player, which needs moderation and a report path before it needs a UI.
  Worth doing deliberately, as its own piece of work.
- **`admin_notify`.** The operator's live banner broadcast. It emits
  `{mesage: …}` — one `s` — with the correct spelling alongside, and that typo
  IS the wire protocol. Not wired: it is a staff-triggered push with no
  persistence (`notifications.broadcast` in admin-service is the durable path),
  and there is no way to trigger one from this deployment to test against,
  because staff login is still blocked by the 2FA enrolment gate Phase 0 hit.
- **Playwright.** The unit suite covers the adapters, the token store's
  single-flight refresh, the socket encode/decode wrapper, the rate-limit
  rules and the error boundary. An end-to-end register → log in → view balance
  → play a round is not there. It needs the whole platform up and a browser
  download, which makes it the same fixture problem `verify:api` has in CI, and
  it should land with that fixture rather than before it.
- **`LAST_BETS` as a push.** All three feeds are POLLS: the platform answers
  these events on request and broadcasts nothing on them, so "live" here means
  a twenty-second interval with a rate-limit backoff, not a subscription.

#### Verification

    npm run lint                    # 0 errors, 5 fast-refresh warnings
    npm test                        # 168 tests
    npm run build
    npm run verify:socket-events    # 12 client names against the backend's 156
    npm run verify:api              # 71 checks, seven of them over the socket

The socket section of `verify:api` connects **directly to user-service**, not
through the gateway: the gateway strips `upgrade` with the other hop-by-hop
headers, so a websocket handshake sent at :4000 never reaches a service. It
takes `SOCKET_BASE` for a deployment where user-service is not on
`127.0.0.1:4001`.

> **One restart needed.** The `C.NOTIFICATION` fix is a source change to
> user-service, and `backend/scripts/dev.js` has no file watcher. A
> user-service process started before 2026-09-10 is still serving the old
> handler and will still answer `SOCKET_HANDLER_FAILED`; the fix was verified
> against a second instance on :4111. Restart `npm run dev …` to pick it up.

---

## Sports: excluded, and how to switch it on

Nothing in Phases 0–8 references sports. To add it later:

1. Start the two processes: `npm run dev … sports` plus
   `npm run start:sports-worker` (the worker is separate because the odds job
   polls every 2 seconds and must run exactly once).
2. Set `REDIS_URL` — required beyond local development, or the worker caches
   into its own heap while the HTTP service reads its own empty one.
3. Fill `SPORTS_FEED_URL` / `SPORTS_FEED_KEY`.
4. Flip the kill switch: `PUT /api/v1/admin/site-config/sports`.
5. Front end: a `/sports` route and the `sports-service` block in
   `lib/endpoints.js`. One caveat — `POST /api/v1/sports/bets` hand-rolls its
   own envelope **and** its own error handling
   (`200 {success, exposure, balanceDelta, oldBalance, newBalance, totalExposure}`,
   `400 {success: false, message}`), so it must bypass the standard `api.js`
   unwrap. It is the one route in the platform where a failure never reaches the
   shared error handler.

---

## Files this touches

**New in `apps/web/src/`:** `lib/api.js`, `lib/endpoints.js`, `lib/socket.js`,
`auth/AuthProvider.jsx`, `auth/tokenStore.js`, `data/adapters/*.js`,
`queries/*.js`, `components/wallet/WalletDrawer.jsx`, `pages/account/*`,
`pages/Blog.jsx`, `pages/Promotions.jsx`.

**Modified:** `apps/web/src/App.jsx` (account + content routes, `RequireAuth`),
`components/layout/Header.jsx` (signed-in cluster), `layout/SearchDialog.jsx`,
`pages/{Home,Category,Provider,Providers,Play,Login,SignUp}.jsx`,
`lib/format.js`, `vite.config.js`, root `package.json`.

**Deleted:** `apps/api/` entirely.

**Backend (small, additive):** `scripts/seed-data.js` (new `catalogue` set),
`tools/verify-frontend-routes.js` (register the web registry), `.env`
(`SOCKET_ALLOWED_ORIGINS`). Optionally
`services/user/src/modules/crypto/routes/user.routes.js` for the deposit-address
HTTP route.

**Docs to update as phases land:** `docs/05-architecture.md` (the `data/` seam
is no longer static), `docs/09-roadmap.md` (the Stubbed table), and
`docs/01-project-overview.md`'s "Status" paragraph.

---

## Verification

Per phase, in order:

```bash
# Phase 0
cd backend && npm run db:status && npm run verify:modules
npm run dev user admin casino gateway
curl localhost:4000/api/v1                       # endpoint index
curl "localhost:4000/api/v1/casino/games?limit=5"  # seeded rows
curl localhost:4000/api/v1/admin/site-config/public

# Phase 1
cd backend && node tools/verify-frontend-routes.js --list

# Phase 3 — against a seeded demo account
curl -X POST localhost:4000/api/v1/user/auth/login \
  -H 'content-type: application/json' \
  -d '{"identifier":"<demo>","password":"<pw>"}'

# Phase 4
curl localhost:4000/api/v1/user/wallet/balances -H "Authorization: Bearer $TOK"

# Every phase
cd backend && npm test          # 1095 tests, needs an ibitplay_test database
npm run lint && npm run build   # repo root
```

Browser check per phase with the `run` skill: home renders API-backed rails
with skeletons on cold cache → register and log in → balance chip shows the
seeded balance → deposit drawer reads an address → one in-house original
completes a round and the balance changes.

Watch the browser console for two specific failures: a CORS refusal means
`CORS_ORIGIN`/`SOCKET_ALLOWED_ORIGINS` in `backend/.env`, and a **422** on a
list means the wrong pagination pair for that route — check its validator
before assuming the route is broken.

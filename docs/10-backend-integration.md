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
| 0 — Environment and data foundation | Part done. `apps/api` retired from the workspace and the dev scripts; `vite.config.js` proxies `/api` to the gateway and `/socket.io` to user-service; `backend/.env` carries `CORS_ORIGIN` and `SOCKET_ALLOWED_ORIGINS`. **The catalogue seeder is not written and the sports kill switch is not flipped** — neither is needed for accounts. |
| 1 — The API seam | **Done.** `lib/endpoints.js`, `lib/api.js`, and the registry wired into `backend/tools/verify-frontend-routes.js`, which passes. No adapters or query layer yet — those arrive with the catalogue in Phase 2, which is what needs them. |
| 2 — Public catalogue | Not started. Pages still read `data/catalog.js`. |
| 3 — Auth and session | **Done.** Register, log in, 2FA, refresh, logout, `/me`, route guards, and the full signed-in header cluster — wallet, recents, notifications, account. |
| 4 — Socket transport and the wallet | Started early, from the header down. `GET /user/wallet/balances` is live behind the balance chip and the deposit drawer; the socket client, deposit addresses, withdrawals and history are not. |
| 5–8 | Not started. |

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

---

## Phase 5 — Play

Goal: `Play.jsx` stops being a placeholder panel.

**Two launch paths, and they are genuinely different:**

*In-house Originals — playable today, no provider account.* The `in-house`
module implements 20 games (`crash`, `plinko`, `limbo`, `mine`, `keno`,
`blackjack`, `roulette`, `classic_dice`, `hilo`, `tower`, …) with
provably-fair engines that debit, resolve and pay out in one transaction
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

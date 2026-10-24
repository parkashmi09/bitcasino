# iBitPlay — Microservices + Modular Backend Blueprint

**Status: Phases 0, 1, 2 are built; Phase 3 is under way (159 / 580 routes).** The gateway, four service skeletons,
the module loader, both run modes, the `sports/settlement` reference module and
the **money spine** (`user/wallet` + `user/auth`) are on disk and tested — the
wallet against a real PostgreSQL. See [§12](#12-phased-plan) for what remains.

Decisions taken (from [§13](#13-decisions-i-need-from-you-before-writing-code)):
admin routes live in the **owning service**, router files are **nested**,
`dev:mono` is **enabled**, the stack stays **JavaScript**, and settlement is the
reference module. Socket.io (§13.6) is still an open design question.

```bash
npm run verify:modules   # mount every module, print the route table (no DB)
npm test                 # 104 tests (money tests need a database)
npm run verify:routes    # legacy port progress
npm run verify:models    # diff every model against the real schema (needs a DB)

# The money guarantees, against a real PostgreSQL:
createdb ibitplay_test && node packages/db/src/cli.js migrate   # DB_NAME=ibitplay_test
node --test services/user/src/modules/wallet/__tests__/wallet.money.test.js
```

---

## 1. What is actually in the repo today

I walked `legacy/` end to end and ran the existing inventory tool. Two things
matter before any design discussion.

### 1.1 The route inventory

| | Count |
|---|---|
| Route declarations found in `legacy/` | **591** |
| Unique `METHOD + path` after de-duplication | **580** |
| Route files (`*routes.js`, `router.js`) | 54 files → 436 declarations |
| Routes declared inline in `legacy/index.js` (236 KB, one file) | ~120 (`server.get` × 63, `server.post` × 47, `put` × 1, `delete` × 1) |
| Mount points (`server.use('/prefix', router)`) in `index.js` | 51 |
| Raw SQL calls to convert to Sequelize | ~1,602 |

Current split by target service, from `node tools/route-inventory.js --report`:

| Service | Module | Routes |
|---|---|---:|
| **user** | payments | 90 |
| | rewards | 89 |
| | accounts | 32 |
| | wallet | 23 |
| | payment-callbacks | 5 |
| | **subtotal** | **239** |
| **casino** | games | 93 |
| | provider-callbacks | 14 |
| | bets | 11 |
| | **subtotal** | **118** |
| **admin** | management | 106 |
| | notifications | 7 |
| | **subtotal** | **113** |
| **sports** | betting | 106 |
| **platform** | infrastructure (health, static, uploads) | 4 |
| | **TOTAL** | **580** |

The full route-by-route list already exists and stays the source of truth:
[docs/API-ROUTES.md](API-ROUTES.md), [docs/route-manifest.json](route-manifest.json),
[docs/ROUTE-PORT-CHECKLIST.md](ROUTE-PORT-CHECKLIST.md).

### 1.2 What is built vs. what is missing

This is the finding that shapes the plan.

**Already built and usable:**

| Path | Contents |
|---|---|
| [packages/db/](../packages/db/) | Sequelize connection, **129 models** across 6 domain folders (core 41, casino 46, admin 16, payments 14, sports 14, extended 3), `associations.js`, `manifest.json`, `BaseRepository`, transaction/lock helpers, migrator + CLI, **7 migrations**, 2 seeders, a baseline SQL schema of 132 tables, and a model generator |
| [packages/common/](../packages/common/) | `createApp`, env loader, pino logger, error taxonomy, response envelope, `ServiceClient` (retry + circuit breaker + request-id propagation), exact-decimal `money`, and 6 middleware: requestContext, validate (zod), rateLimit, internalAuth, errorHandler, notFound |
| [packages/auth/](../packages/auth/) | JWT player/refresh/staff tokens, bcrypt, TOTP 2FA, `authenticate` / `requireActive` / `requirePermission`, RBAC permission map |
| [tools/route-inventory.js](../tools/route-inventory.js) | Walks legacy, assigns each route an owner service+module, diffs against `@legacy` tags in the new services, regenerates the checklist |
| [docs/](.) | API-ROUTES, BETTING-LOGIC, LEGACY-PORT, ROUTE-PORT-CHECKLIST |

**Was missing when this document was written — now built (Phase 0/1):**

```
gateway/            services/user/    services/admin/
services/casino/    services/sports/  services/sports/src/worker.js
```

`package.json` declared `workspaces: ["packages/*", "services/*", "gateway"]`,
`scripts/dev.js` spawned six processes from those directories, and the README
and `docs/LEGACY-PORT.md` both linked into them — but none of it existed, so
`npm run dev` failed and the port tracker reported 0 ported for want of
somewhere to put the `@legacy` tags.

So the job was never "design from zero". It is: **build the gateway and four
services on top of the existing shared layer, using a module format that works
both ways, then port the routes into it.**

### 1.3 A correction to the route count

`tools/route-inventory.js` resolved a mount prefix only when the router was
required inline:

```js
server.use('/kyc', require('./kyc/routes'))            // resolved
server.use('/api/internalsettle', settlementRoutes)    // NOT resolved -> prefix null
```

The second form is the common one — 51 of the mounts in `legacy/index.js` are
variables — so most router files recorded bare paths (`/momatches` rather than
`/api/internalsettle/momatches`). Bare paths collide across routers
(`/momatches` is also declared in `sportsbet/routes.js`), and the de-duplication
step then merged genuinely different endpoints into one.

With the resolver fixed, the real total is **580 unique routes, not 558** — 22
endpoints were being hidden by that merge. Every count in this document has been
updated.

---

## 2. Target architecture

```
                              clients (web / mobile / provider callbacks)
                                            │
                            ┌───────────────▼───────────────┐
                            │       gateway  :4000          │  edge: CORS, helmet, rate limit,
                            │  verifies token ONCE          │  token verify, header stripping,
                            │  strips spoofable headers     │  legacy path compat, /health fan-in
                            │  refuses to proxy /internal/* │
                            └───┬────────┬────────┬─────────┘
              /api/v1/user/**   │        │        │   /api/v1/sports/**
              /api/v1/admin/**  │        │        │   /api/v1/casino/**
        ┌───────────────────────▼──┐  ┌──▼─────┐  ▼──────────┐  ┌──────────────┐
        │      user  :4001         │  │ admin  │  │ casino    │  │ sports :4004 │
        │  identity, wallet,       │  │ :4002  │  │ :4003     │  │              │
        │  payments, rewards       │  │        │  │           │  │ sports-worker│
        └───────────┬──────────────┘  └───┬────┘  └─────┬─────┘  └──────┬───────┘
                    ▲                     │             │               │
                    └─────────────────────┴─────────────┴───────────────┘
                      internal API  ·  x-internal-key + x-internal-service
                      every balance change funnels into user-service
                                            │
                    ┌───────────────────────▼────────────────────────┐
                    │  PostgreSQL — ONE database, 132 tables         │
                    │  ownership enforced per service, not per DB    │
                    └────────────────────────────────────────────────┘
```

| Process | Port | Owns (writes) | Reads via |
|---|---:|---|---|
| gateway | 4000 | nothing | — |
| user | 4001 | `core` + `payments` domains (55 models) | — |
| admin | 4002 | `admin` domain (16 models) | user/casino/sports internal APIs |
| casino | 4003 | `casino` domain (46 models) | user internal API for money |
| sports | 4004 | `sports` domain (14 models) | user internal API for money |
| sports-worker | 4104 (health only) | `sports` (same container as sports) | — |

**One database, not one per service.** A sports bet must debit a wallet in the
same transaction it writes the bet. Splitting the database turns a real ACID
guarantee into a distributed-transaction problem for no benefit at this scale.
The boundary is enforced at the *service* layer: exactly one service writes a
given table, others go through its API. That ownership is already written down
in [packages/db/tools/domain-map.js](../packages/db/tools/domain-map.js) and is
enforced by which model domains each service loads at boot.

---

## 3. The module format — your `mannualsettlement` requirement

`legacy/mannualsettlement/` today is three files — `routes.js`, `controller.js`,
`voidaftersettlement.js` — with SQL, business rules, auth, and activity logging
all mixed into the controller. Its *shape* is right (one folder = one feature),
its *layering* is not. Here is the format I propose, using that same feature as
the worked example.

### 3.1 Folder layout of one module

```
services/sports/src/modules/settlement/
├── index.js                        ← module manifest (the contract, see §3.2)
├── settlement.constants.js         ← enums, market types, status values
├── settlement.errors.js            ← this module's error catalogue (§6)
├── settlement.validators.js        ← zod schemas per endpoint (§7)
├── settlement.repository.js        ← ALL Sequelize access for this module
├── settlement.service.js           ← business rules; no req/res, no SQL
├── settlement.policy.js            ← who may do what (optional, RBAC rules)
├── routes/
│   ├── user.routes.js              ← player-facing endpoints
│   ├── admin.routes.js             ← staff-facing endpoints
│   ├── internal.routes.js          ← service-to-service endpoints
│   └── public.routes.js            ← unauthenticated (optional)
├── controllers/
│   ├── user.controller.js          ← HTTP in/out only; calls the service
│   ├── admin.controller.js
│   └── internal.controller.js
└── __tests__/
    ├── settlement.service.test.js
    └── settlement.routes.test.js
```

You asked for `userservice.route` / `adminservice.route`. I am proposing
`routes/user.routes.js` + `routes/admin.routes.js` inside the module instead of
flat `userservice.route.js` files, because with ~40 modules a flat naming scheme
produces 80 sibling files with near-identical names. **The split you asked for is
preserved exactly — one router file per audience — just nested one level.** If
you prefer the flat form, say so and I will use `settlement.user.routes.js` /
`settlement.admin.routes.js` at the module root; it costs nothing to change now
and is painful to change later.

### 3.2 The module manifest — what makes it work in both modes

`index.js` is the whole trick. A module never mounts itself and never knows what
process it is in:

```js
// services/sports/src/modules/settlement/index.js
'use strict';

module.exports = {
  name: 'settlement',
  service: 'sports',            // which microservice owns it
  basePath: '/settlement',      // path suffix within its audience prefix
  models: ['sports', 'core'],   // db domains it needs loaded
  routers: {
    user:     require('./routes/user.routes'),
    admin:    require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
  // Optional lifecycle hooks the host process calls
  jobs:    require('./settlement.jobs'),   // for the worker process
  events:  require('./settlement.events'), // socket.io subscriptions
};
```

A tiny loader mounts every module the same way:

```js
// services/sports/src/app.js
const modules = loadModules(__dirname + '/modules');   // reads each index.js

for (const m of modules) {
  if (m.routers.public)   app.use(`/api/v1/${m.service}${m.basePath}`, m.routers.public);
  if (m.routers.user)     app.use(`/api/v1/${m.service}${m.basePath}`, authPlayer, m.routers.user);
  if (m.routers.admin)    app.use(`/api/v1/admin/${m.service}${m.basePath}`, authStaff, m.routers.admin);
  if (m.routers.internal) app.use(`/internal/${m.service}${m.basePath}`, internalAuth, m.routers.internal);
}
```

**Microservices mode** (`npm run dev`): four processes, each running
`loadModules()` over its own `modules/` folder. Cross-service calls go over HTTP
through `ServiceClient`.

**Modular-monolith mode** (`npm run dev:mono` — a single process, useful for
local dev, cheap deploys, and integration tests): one Express app runs
`loadModules()` over *all four* services' module folders. The only thing that
changes is that `ServiceClient` is swapped for an in-process dispatcher that
calls the target module's internal router directly instead of over the network —
same function signature, same contract, no HTTP hop.

That is the entire cost of supporting both modes: one loader and one
`ServiceClient` implementation swap. Nothing in a module changes.

### 3.3 Layer rules (enforced in review, and by a lint rule)

| Layer | May import | May **not** |
|---|---|---|
| `routes/*.routes.js` | validators, controllers, middleware | services, repositories, models |
| `controllers/*` | services, response helpers, errors | repositories, models, raw SQL |
| `*.service.js` | repositories, other modules' **service clients**, errors, money | `req`/`res`, Express, another module's repository |
| `*.repository.js` | `@ibitplay/db` models, transaction helpers | services, controllers, HTTP |

The rule that actually prevents the legacy mess: **a controller never sees SQL,
and a service never sees `req`.** That is what makes the settlement logic
callable from both the HTTP route and the background worker without duplication.

### 3.4 Worked example — `mannualsettlement` after the port

| Legacy route (`legacy/mannualsettlement/routes.js`) | New path | Router file |
|---|---|---|
| `GET /api/internalsettle/momatches` | `GET /api/v1/admin/sports/settlement/mo-matches` | `admin.routes.js` |
| `GET /api/internalsettle/fanmatches` | `GET /api/v1/admin/sports/settlement/fancy-matches` | `admin.routes.js` |
| `POST /api/internalsettle/declareresult` | `POST /api/v1/admin/sports/settlement/declare-result` | `admin.routes.js` |
| `POST /api/internalsettle/void` | `POST /api/v1/admin/sports/settlement/void-market` | `admin.routes.js` |
| `GET /api/internalsettle/open-bets` | `GET /api/v1/admin/sports/settlement/open-bets` | `admin.routes.js` |
| `POST /api/internalsettle/void-single-bet` | `POST /api/v1/admin/sports/settlement/void-bet` | `admin.routes.js` |
| `GET /api/internalsettle/settled-markets` | `GET /api/v1/admin/sports/settlement/settled-markets` | `admin.routes.js` |
| `GET /api/internalsettle/settled-bets` | `GET /api/v1/admin/sports/settlement/settled-bets` | `admin.routes.js` |
| `POST /api/internalsettle/void-market-after-settlement` | `POST /api/v1/admin/sports/settlement/void-market/post-settlement` | `admin.routes.js` |
| `POST /api/internalsettle/void-bet-after-settlement` | `POST /api/v1/admin/sports/settlement/void-bet/post-settlement` | `admin.routes.js` |
| — (new) | `POST /internal/sports/settlement/settle-match` | `internal.routes.js` — called by the worker |
| — (new) | `GET /api/v1/sports/settlement/my-settled-bets` | `user.routes.js` |

Every old path keeps working via the gateway compat map (§9). Two of these
routes currently accept a raw `x-staff-id` header with no JWT — that is an
authentication hole and is called out in §11.

---

## 4. Module decomposition — all four services

~40 modules total. Route counts are from the inventory.

### 4.1 user-service :4001 — 235 routes

| Module | Legacy source | Routes |
|---|---|---:|
| `auth` | `Users/`, `index.js` login/register/otp | ~12 |
| `profile` | `index.js` editProfile, referral-code/link | ~8 |
| `twofa` | `2fa/` | 5 |
| `kyc` | `kyc/` | 5 |
| `bank-details` | `BankDetails/` | 4 |
| `wallet` | `Wallet/`, `index.js` getwallet/updatebalance/wallethistory | ~15 |
| `swap` | `internalswap/` | 5 |
| `exchange-rate` | `exchangerate/` | 7 |
| `fiat-deposit` | `fiatdeposit/` | 14 |
| `fiat-withdraw` | `fiatwithdraw/`, `withdrawHistory/` | 5 |
| `crypto-deposit` | `index.js` createDeposit/getOrder/getAllChains/ccpayment | ~10 |
| `deposit-history` | `depositHistory/` | 8 |
| `psp-apay` | `apay/` | 5 |
| `psp-cricpay` | `cricpay/` | 5 |
| `psp-waypay` | `waypay/` | 7 |
| `psp-upi` | `index.js` createorderupi/checkorderstatusupi/webhook | 3 |
| `vault-pro` | `vaultpro/` | 12 |
| `p2p-trade` | `peerTrade/` | 25 |
| `bonus` | `bonus/` (3 route files) | 25 |
| `spin-wheel` | `spinwin/` | 11 |
| `gift-cards` | `GiftCards/` | 10 |
| `affiliate` | `affiliate/` (2 files) | 17 |
| `club-membership` | `clubmembership/` (3 files) | 22 |
| `email-otp` | `emailservice/` | 10 |

### 4.2 admin-service :4002 — 108 routes

| Module | Legacy source | Routes |
|---|---|---:|
| `staff-auth` | `system/routes/routes.js` | 4 |
| `staff-management` | `system/routes/staff.js` | ~12 |
| `executives` | `system/routes/access.js` | ~10 |
| `marketing-users` | `system/routes/access.js`, `system/routes/marketing.js` | ~8 |
| `lords` (fund transfer) | `system/routes/lords.js` | ~6 |
| `site-config` | `siteconfig/routes/configRoutes.js` | 5 |
| `user-tree` | `siteconfig/routes/userTreeRoutes.js`, `lookupRoutes.js` | 2 |
| `risk-control` | `siteconfig/routes/adminRiskRoutes.js`, `locksystem/` | 4 |
| `admin-deposits` | `system/deposit/routes.js` | 9 |
| `balance-sheet` | `balancesheet/` | 1 |
| `agent-report` | `report/` | 7 |
| `user-report` | `reports/` | 3 |
| `dashboard` | `index.js` /api/admin/dashboard, user-stats, totals | ~12 |
| `banners` | `Banners/` | 6 |
| `blogs` | `Blogs/` (2 files) | 9 |
| `notifications` | `firabsenotifcation/` | 7 |
| `activity-log` | `system/utils/recordActivity` | — (cross-cutting) |

### 4.3 casino-service :4003 — 112 routes

| Module | Legacy source | Routes |
|---|---|---:|
| `gis-catalogue` | `gis/` | 49 |
| `xgaming` | `xgamingapi/` | 3 |
| `js-games` | `jsgames/`, `jsgamesv2/` | 12 |
| `slots` | `Slots/` | — (socket-driven) |
| `inhouse-games` | `Games/` (Crash, Keno, Dice, Mines, Bots) | — (socket-driven) |
| `house-bank` | `index.js` start/stop/win/reset-house, updatehouse | 6 |
| `game-launch` | `index.js` launch-game, game_launch, game-list | ~8 |
| `provider-callbacks` | `index.js` `/api/seamless/*`, `/api/casino/*`, `callback_evo`, `gold_api` | 14 |
| `bet-history` | `bethistory/` | 8 |
| `transactions` | `index.js` transaction/live, transaction/slot | 2 |

### 4.4 sports-service :4004 — 99 routes

| Module | Legacy source | Routes |
|---|---|---:|
| `feed` | `sportsapi/sportsapiroutes.js` (matches, series, sports config) | ~20 |
| `markets` | `sportsapi/` (market-ids, market-odds, bookmakerFancy, lineMarket) | ~8 |
| `fancy-controls` | `sportsapi/` admin fancy endpoints | 5 |
| `betting` | `sportsbet/`, `sportsmain/API/routes.js` place-bet | ~30 |
| `exposure` | `sportsmain/` exposures, net-exposure, market-book | ~8 |
| `settlement` | `mannualsettlement/` | 10 |
| `results` | `sportsapi/resultroutes.js` | 2 |
| `sportsbook` | `sportsbook/` (third-party sportsbook launch) | 5 |
| `bet-lock` | `sportsmain/` admin betlock | 4 |
| `admin-reports` | `sportsmain/` bet-list, bet-ticker, game-report | ~7 |

---

## 5. The shared middleware layer

You asked for "one middleware over all". There are two tiers, and keeping them
separate is what stops the same check running five times per request.

### 5.1 Gateway (runs once, at the edge) — `gateway/src/`

| Order | Middleware | Why here |
|---:|---|---|
| 1 | `requestContext` | Mints `x-request-id` before anything can fail |
| 2 | `helmet` + `cors` | One CORS policy, not four that drift |
| 3 | **header stripping** | Deletes any client-supplied `x-user-id`, `x-staff-id`, `x-internal-key`, `x-internal-service`. Without this, a client forges identity. |
| 4 | `rateLimit` (per IP) | Cheap rejection before a proxy hop is spent |
| 5 | `verifyToken` | JWT verified **once**; injects trusted `x-user-id` / `x-staff-id` / `x-roles` downstream |
| 6 | **`/internal/*` refusal** | Hard 404 on any path containing `/internal/` |
| 7 | `legacyRoutes` compat map | Rewrites old legacy paths → new paths (§9) |
| 8 | `proxy` | Streams to the target service by prefix |
| 9 | `/health` aggregator | Fans out to all four, returns combined status |

### 5.2 Per service — from `@ibitplay/common/createApp` (already written)

`trust proxy` → `requestContext` → `helmet` → `cors` → body parse (size-capped)
→ `pino-http` → `rateLimit` → **module routers** → `notFound` → `errorHandler`.

### 5.3 Per audience — applied by the module loader, not by each module

| Guard | Applied to | Source |
|---|---|---|
| `authenticate` + `requireActive` | every `user.routes.js` | `@ibitplay/auth` |
| `authenticateStaff` + `requirePermission(...)` | every `admin.routes.js` | `@ibitplay/auth` |
| `internalAuth` | every `internal.routes.js` | `@ibitplay/common` (timing-safe key compare, already written) |
| nothing | `public.routes.js` | — |

Because the loader applies these, a module physically cannot forget its auth.
That is the fix for the legacy state where `protectStaff` is on some settlement
routes and absent from others in the same file.

### 5.4 Cross-cutting, applied per-route

- `validate({ params, query, body })` — zod, replaces the request part with the
  parsed value so unknown keys are stripped (already written).
- `withActivity({ action, describe })` — the legacy staff-audit wrapper, kept,
  but moved to `@ibitplay/common` and writing through the admin-service internal
  audit API rather than a direct table write.
- `idempotent()` — reads `Idempotency-Key`, short-circuits replays. Required on
  every money-moving POST.

---

## 6. Error configuration

### 6.1 Three levels

**Platform taxonomy** — already exists in
[packages/common/src/errors.js](../packages/common/src/errors.js): `AppError`
with `status` / `code` / `details` / `isOperational`, plus `BadRequestError`,
`ValidationError` (422), `UnauthorizedError`, `ForbiddenError`, `NotFoundError`,
`ConflictError`, `TooManyRequestsError`, `ServiceUnavailableError`. The shared
`errorHandler` is the only place that decides what reaches a client; anything
not an `AppError` becomes a generic 500 with the stack logged, never returned.

**Per-module catalogue** — `settlement.errors.js`:

```js
'use strict';
const { defineErrors } = require('@ibitplay/common/errors');

module.exports = defineErrors('SETTLEMENT', {
  MARKET_ALREADY_SETTLED:  { status: 409, message: 'This market has already been settled' },
  MARKET_NOT_FOUND:        { status: 404, message: 'Market not found' },
  NO_OPEN_BETS:            { status: 409, message: 'No open bets for this market' },
  WINNER_NOT_IN_MARKET:    { status: 422, message: 'The selected winner is not a runner in this market' },
  VOID_WINDOW_EXPIRED:     { status: 409, message: 'Void window has expired for this market' },
  SETTLEMENT_IN_PROGRESS:  { status: 409, message: 'Settlement is already running for this market' },
  PAYOUT_EXCEEDS_LIMIT:    { status: 422, message: 'Calculated payout exceeds the configured maximum' },
});
```

`defineErrors` prefixes every code (`SETTLEMENT_MARKET_ALREADY_SETTLED`),
registers it in a platform-wide registry that **throws at boot on a duplicate
code**, and returns ready-to-throw constructors:

```js
throw errors.MARKET_ALREADY_SETTLED({ marketId, settledAt });
```

**Client-facing message config** — `packages/common/src/errors/messages/en.json`
maps every registered code to display text, so messages are translatable and
changing the wording never requires a code change. The generated catalogue of
all codes ships as `docs/ERROR-CODES.md`.

### 6.2 Rules

- Codes are **stable API**; messages are not. Clients branch on `code`.
- Every error carries the `x-request-id`, so a support ticket maps to a log line.
- 5xx never returns an internal message.
- Validation failures return the field list in `details`, matching the shape
  `validate` already produces: `[{ field, message, code }]`.

---

## 7. Validation

One zod schema file per module, one schema per endpoint, named after the handler:

```js
// settlement.validators.js
const { z } = require('zod');
const { idParam, listQuery } = require('@ibitplay/common/middleware/validate');

const declareResult = {
  body: z.object({
    match_id:    z.coerce.number().int().positive(),
    eventid:     z.string().min(1).max(64),
    market_type: z.enum(['MATCH_ODDS', 'BOOKMAKER', 'FANCY', 'LINE']),
    game_type:   z.string().min(1).max(32),
    winnerId:    z.coerce.number().int().positive().optional(),
    winnerName:  z.string().min(1).max(128).optional(),
    fancyName:   z.string().max(128).optional(),
    runValue:    z.coerce.number().int().min(0).optional(),
  }).refine(v => v.winnerId != null || v.runValue != null, {
    message: 'Either winnerId (market result) or runValue (fancy result) is required',
  }),
};

const openBets = { query: listQuery.extend({ marketId: z.string().min(1) }) };

module.exports = { declareResult, openBets, /* … */ };
```

Used at the route:

```js
router.post('/declare-result',
  requirePermission('sports.settlement.declare'),
  validate(v.declareResult),
  withActivity({ action: 'settle.declare-result', describe: r => ({ targetType: 'MARKET', targetId: r.body.match_id }) }),
  idempotent(),
  ctrl.declareResult);
```

Non-negotiables:

- Money is `z.string().regex(/^\d+(\.\d{1,8})?$/)` — **never** `z.number()`. It
  stays a string end to end and is only ever arithmetic'd through
  `@ibitplay/common/money` (BigInt minor units). A JS float in a balance path is
  a rejected PR.
- Every list endpoint uses the shared `listQuery` (page/limit/sort/search) with
  a hard `limit` cap. Legacy has unbounded `SELECT *` list endpoints.
- File uploads validate MIME type, extension, magic bytes and size before disk.
  Legacy `multer` usage in `Banners/`, `Blogs/`, `kyc/`, `fiatdeposit/`,
  `clubmembership/`, `peerTrade/` accepts whatever it is handed.

---

## 8. Database design — Sequelize

### 8.1 What already exists

132 tables, **129 generated models** in `packages/db/src/models/`, grouped by the
domain map:

| Domain | Models | Owner service |
|---|---:|---|
| `core` (identity, credits, ledger, sessions, bonuses, clubs, vault) | 41 | user |
| `payments` (deposits, withdrawals, PSPs) | 14 | user |
| `casino` (games, providers, in-house rounds, casino bets) | 46 | casino |
| `sports` (fixtures, markets, sports bets, settlement) | 14 | sports |
| `admin` (staff, roles, config, audit) | 16 | admin |
| `extended` | 3 | — |

Migrations `000`–`006` exist (baseline schema, auth sessions, ledger precision,
bet identity, provably-fair seeds, exposure constraints, settlement queue), plus
seeders for roles/admin and in-house games. `BaseRepository`, `transaction.js`
(with `FOR UPDATE` helpers) and the Umzug-based migrator/CLI are in place.

### 8.2 Conventions to hold to

**Table ownership.** `packages/db/tools/domain-map.js` assigns every table a
domain; the domain determines the owner service. A service loads only its own
domains at boot, so importing the wrong model is a runtime error rather than a
silent cross-service write.

**Money columns.** `NUMERIC(30,8)`, never `float`/`double`. They cross service
boundaries as strings. `money.add/sub/mul/cmp` work in `BigInt`.

**Every balance change is:**
1. `SELECT … FOR UPDATE` on the credits row (no read-then-write),
2. `UPDATE … SET amount = amount + :delta WHERE … AND amount + :delta >= 0`
   (the guard is in SQL, not JS),
3. a `credits_ledger` insert in the **same** transaction,
4. all inside a real pooled transaction.

This directly replaces the legacy pattern that `legacy/General/Model/pool.js`
warns about in its own header — `BEGIN`/`COMMIT` on a *shared* client, where one
request's transaction can wrap another's queries.

**Idempotency.** `credits_ledger` carries a unique `(idempotency_key)`. A replay
returns the original row instead of moving money twice.

**Naming.** Tables `snake_case` plural, models `PascalCase` singular, timestamps
`created_at` / `updated_at`, soft delete only where legacy already has it.

**Associations** live only in `models/associations.js`, never inline in a model,
so the graph is readable in one file.

**Migrations are forward-only and reversible.** No `sync({ alter: true })` in any
environment. Schema change = new numbered migration.

### 8.3 New migrations this port needs

| # | Purpose |
|---|---|
| 007 | `idempotency_keys` table + unique index on `credits_ledger.idempotency_key` |
| 008 | `outbox` table (event publishing, §10.4) |
| 009 | Foreign keys and NOT NULLs the legacy schema is missing (audit needed first) |
| 010 | Indexes for the new list endpoints — legacy has unindexed sorts on `bets`, `transactions`, `wallet_history` |
| 011 | `admin_activity_logs` extension for `internal_caller` (who moved money) |

---

## 9. Legacy compatibility

580 routes have live clients. Some paths are registered on **provider** systems
(`/api/seamless/*`, `/api/ccpaymentnotify`, `/callback_evo`, `/webhook/*`) and
cannot be renamed without a support ticket to the provider.

**`gateway/src/legacyRoutes.js`** holds the full old→new map, generated from
`docs/route-manifest.json`:

```js
'POST /updatebalance'            → 'POST /api/v1/user/wallet/admin/balance'
'GET  /api/internalsettle/momatches' → 'GET  /api/v1/admin/sports/settlement/mo-matches'
'POST /api/seamless/withdraw'    → 'POST /api/v1/casino/provider/seamless/withdraw'
```

Both paths work; the legacy path is a rewrite, not a redirect (callbacks do not
follow 3xx). Each mapping logs at `info` with a `legacy_path` field, so after a
few weeks the logs show exactly which old paths still have traffic and can be
retired.

**Response shape:** ported routes return the legacy body **verbatim** where a
client parses it — `GET /wallethistory/:uid` keeps returning `{ history, count }`,
not the platform envelope. Fields may be *added*, never renamed or removed. New
routes use the standard envelope. This is already the documented rule in
[docs/LEGACY-PORT.md](LEGACY-PORT.md).

**Proof of coverage:** a handler claims a route with a `@legacy` tag —

```js
/** @legacy POST /api/internalsettle/declareresult */
async declareResult(req, res) { … }
```

— and `tools/route-inventory.js` diffs those tags against legacy. The checklist
**cannot** be marked complete by editing it. In a 580-route port the failure mode
that matters is a route quietly disappearing and nobody noticing until a player
does.

---

## 10. Inter-service communication

### 10.1 Transport

Synchronous HTTP over the private network via `ServiceClient`
([packages/common/src/serviceClient.js](../packages/common/src/serviceClient.js),
already written): shared internal key + caller identity on every request,
request-id propagation, hard timeout, bounded retry **only** for idempotent verbs
and only on transport failure/5xx, circuit breaker, and upstream error codes
preserved (a wallet `INSUFFICIENT_FUNDS` reaches the player as
`INSUFFICIENT_FUNDS`, not a generic 503).

Every internal route sits under `/internal/**`, is guarded by `internalAuth`
(constant-time key compare), and the gateway hard-refuses to proxy any path
containing `/internal/`. Two independent layers, because one is a config change
away from being wrong.

### 10.2 The internal API surface

**user-service — the only writer of money.**

| Endpoint | Called by | Notes |
|---|---|---|
| `POST /internal/wallet/debit` | casino, sports | `{ userId, amount, currency, reason, refType, refId, idempotencyKey }` |
| `POST /internal/wallet/credit` | casino, sports, admin | same shape |
| `POST /internal/wallet/rollback` | casino, sports | compensating refund, references original ledger id |
| `POST /internal/wallet/transfer` | admin (lords), user (vault, p2p) | two-legged, one transaction |
| `GET /internal/wallet/balance/:userId` | all | |
| `GET /internal/users/:id` | admin, casino, sports | identity resolve |
| `POST /internal/users/lookup` | admin | batch, avoids N+1 across the hierarchy |
| `GET /internal/users/:id/limits` | casino, sports | bet lock, risk config, wager target |
| `POST /internal/users/:id/wager` | casino, sports | wager-target progress on settle |

**admin-service.**

| Endpoint | Called by | Notes |
|---|---|---|
| `POST /internal/audit/activity` | all | staff action audit; `withActivity` writes here |
| `GET /internal/staff/:id/hierarchy` | user, sports | agent tree for reports and exposure |
| `GET /internal/staff/:id/permissions` | gateway | resolved from the **current** DB role, so a demoted account loses access immediately rather than at token expiry |
| `GET /internal/config/global` | all | site config, cached 30 s |
| `GET /internal/config/user/:uid` | casino, sports | per-user risk/limits/commission |

**casino-service.**

| Endpoint | Called by | Notes |
|---|---|---|
| `GET /internal/casino/bets` | admin | reports, filtered by user/date |
| `GET /internal/casino/stats` | admin | dashboard aggregation |
| `POST /internal/casino/rounds/:id/settle` | worker | |

**sports-service.**

| Endpoint | Called by | Notes |
|---|---|---|
| `GET /internal/sports/bets` | admin | |
| `GET /internal/sports/exposure/:userId` | user, admin | liability book |
| `GET /internal/sports/stats` | admin | |
| `POST /internal/sports/settlement/settle-match` | worker | |

### 10.3 The money protocol

Placing a bet is not one call, so it needs a defined failure path:

```
casino                                          user-service
  │  1. POST /internal/wallet/debit  ──────────▶ lock row, guard >= 0,
  │     Idempotency-Key: bet:9f3a…               write credits + ledger, commit
  │  ◀───────────────────────────────────────── { ledgerId, newBalance }
  │  2. write bet row locally (casino db domain)
  │     ✗ fails  ────────────────────────────▶  3. POST /internal/wallet/rollback
  │                                                { ledgerId, reason: 'BET_WRITE_FAILED' }
  │  4. round resolves
  │  5. POST /internal/wallet/credit  ─────────▶ payout, ledger entry
  │     Idempotency-Key: win:9f3a…
```

Rules:
1. **Debit before the round resolves**, never after.
2. **Idempotency key on every money call**, derived from the bet id — a retry
   after a timeout returns the original ledger row, it does not pay twice.
3. **Compensating refund on any post-debit failure**, automatically. A refund
   that itself fails is logged at `fatal` with everything needed to reconcile by
   hand, never swallowed.
4. **No retry on POST**, ever — retrying "debit this wallet" double-charges.
   `ServiceClient` already enforces this by verb.

### 10.4 Asynchronous events (phase 5, optional)

For fan-out that must not block a request — notifications, affiliate commission,
club earnings, dashboard counters — a transactional **outbox**: the producing
service writes the event row in the same transaction as the state change, and a
poller publishes it. No message broker until the volume justifies one; the
outbox table means adding Redis/NATS later is a change to the publisher only.

---

## 11. Problems in the legacy code this port must fix

Found while reading. Each is a deliberate, documented behaviour change, not an
accident of the port.

| | Issue | Where |
|---|---|---|
| 1 | `BEGIN`/`COMMIT` on a **shared** pg client — one request's transaction can wrap another's queries. The file's own header warns about this. | `legacy/General/Model/pool.js`, every controller using `pg.query('BEGIN')` |
| 2 | Balance read then updated with nothing holding the row — `previous_balance`/`new_balance` in `wallet_history` can record numbers that never existed | `index.js` `/updatebalance` |
| 3 | Debit clamped to 0 in *history* but decremented unclamped in the *column* — history says `0`, balance says `-50` | `index.js` `/updatebalance` |
| 4 | Settlement routes accept a raw `x-staff-id` header with no JWT — anyone can void a settled market | `mannualsettlement/routes.js:51-52` |
| 5 | `protectStaff` present on some routes and absent on siblings in the same router | `mannualsettlement/`, `sportsapi/`, `peerTrade/` |
| 6 | Duplicate route declaration — the second silently never runs | `peerTrade/routes.js` `POST /admin/p2p/sell-release/:orderId` × 2 |
| 7 | `index.js` is 236 KB in one file with ~120 inline handlers | `legacy/index.js` |
| 8 | Firebase admin service-account **private key committed to the repo** | `legacy/bitcoinjito-e3078-firebase-adminsdk-*.json` |
| 9 | `.env` with live values committed | `legacy/.env` |
| 10 | CORS origin list hard-coded across five domains in source | `legacy/index.js:8` |
| 11 | Unbounded list endpoints — no pagination cap on admin bet/transaction lists | `sportsmain/`, `bethistory/`, `reports/` |
| 12 | ~1,602 raw SQL calls, string-concatenated in places | throughout |

**Items 8 and 9 need attention today, independently of this port** — those
credentials should be rotated whether or not the file is removed, because they
are already in the working tree.

---

## 12. Phased plan

Each phase ends with something runnable and verifiable. No phase depends on a
later one.

| Phase | Deliverable | Verification |
|---|---|---|
| **0 — DONE** | `gateway/` + four `services/*` skeletons; module loader; `dev:mono`; health endpoints; `.env` wiring; `sports/worker.js` | Gateway boots and serves `/api/v1`; `/internal/*` returns 404 from the edge; `npm run verify:modules` mounts 3 modules / 17 routes |
| **1 — DONE** | `sports/settlement` ported end to end (constants → errors → validators → repository → service → controllers → 3 routers → tests), all 10 legacy paths in the gateway compat map, plus `admin/staff-directory` and `admin/audit` so staff auth and the audit trail work | `npm test` → 32 passing; `npm run verify:routes` → 10 ported; `GET /api/internalsettle/momatches` rewrites and proxies to sports-service |
| **3 — IN PROGRESS** | user-service accounts batch (`profile`, `twofa`, `kyc`, `bank-details`, `exchange-rate`, `swap`) then payments (`fiat-deposit`, `fiat-withdraw`). 13 modules / 85 routes live; 35 legacy paths in the gateway map | 64 tests passing; `authBoundaries.test.js` asserts all 32 protected routes refuse an unauthenticated caller AND a forged `x-user-id` header |
| **2 — DONE** | Migration 007 (unique `credits.uid`, ledger idempotency key, four indexes); model-extension mechanism; `user/wallet` with the internal money API; `user/auth` with rotating hashed refresh tokens; `WalletClient` wired into casino and sports | 15 money tests against real PostgreSQL: **10 concurrent debits of 20 against 100 → exactly 5 succeed**; concurrent retries of one idempotency key → **exactly 1 ledger row**; rollback, transfer atomicity, 8-dp precision, reconciliation |
| **2** — money spine *(≈3 days)* | user-service `wallet` + `auth` + internal wallet API; `credits_ledger` idempotency migration; row-lock + guard | Concurrency test: 10 parallel debits of 20 against a balance of 100 → exactly 5 succeed. Replay test: same idempotency key twice → one ledger row |
| **3** — service by service | user (239) → casino (118) → sports (106, minus the 10 done) → admin (113), module by module, each with `@legacy` tags | `route-inventory --report` climbs to 580/580; the checklist cannot be faked |
| **4** — cutover | Gateway fronts both legacy and new; traffic shifted per module; `legacy/` retired path group by path group | Zero `legacy_path` hits in the gateway logs for a retired group over 7 days |
| **5** — hardening *(optional)* | Outbox events, per-module rate limits, OpenAPI generation from the zod schemas, load tests | |

Sequence inside phase 3 is deliberate: **money before features.** Every casino
and sports module depends on the wallet internal API, so building it first means
those modules are written against a real contract rather than a stub.

---

## 13. Decisions I need from you before writing code

| # | Question | My recommendation |
|---|---|---|
| 1 | **Where do admin routes for a domain live?** e.g. admin settlement endpoints — in sports-service (owner of the data) or in admin-service (which calls sports internally)? | **In the owning service**, mounted under `/api/v1/admin/sports/**` and guarded by staff auth. admin-service owns only staff identity, RBAC, audit and cross-domain aggregation. This keeps "one writer per table" true. The alternative doubles every domain's code. |
| 2 | **Router file naming** — `routes/user.routes.js` (nested) or `settlement.user.routes.js` (flat, closer to the `userservice.route` you wrote)? | Nested. 40 modules × 2–3 routers = 80+ near-identical filenames if flat. Trivial to change now, painful later. |
| 3 | **Do you want `dev:mono` (modular-monolith) mode?** | Yes — it costs one loader plus an in-process `ServiceClient` swap, and it makes local dev and integration tests dramatically cheaper. |
| 4 | **New URL scheme** — `/api/v1/<service>/<module>/<action>` for everything new, with all 580 legacy paths kept working through the gateway compat map? | Yes. Provider callback paths keep their exact legacy form permanently. |
| 5 | **TypeScript or JavaScript?** | Stay on JavaScript. The existing `packages/*` are JS; converting mid-port doubles the work and the zod schemas already give runtime validation where it counts. |
| 6 | **Socket.io** — legacy runs in-house games (Crash, Keno, Slots, chat) over sockets from `index.js`. Which service hosts them? | casino-service, with a sticky-session or Redis adapter. Needs its own design pass — it is genuinely separate work from the 580 REST routes and is **not** covered by this document. |
| 7 | **Are the committed Firebase key and `.env` still live?** | If yes, rotate now regardless of this port. |
| 8 | Phase 1 reference module — `sports/settlement` as proposed, or a different one you would rather see first? | settlement, because you named it. |

---

## 14. What happens next

Confirm §13, and I will build **Phase 0 + Phase 1** — the gateway, four service
skeletons, the module loader, both run modes, and `sports/settlement` ported
completely in the final format. That gives you a working, testable reference
module to judge the pattern against before 557 more routes are written into it.

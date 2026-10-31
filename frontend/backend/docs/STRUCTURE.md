# iBitPlay Backend — Structure Guide

**What this document is:** the map of where every kind of file goes and why.
If you are about to create a file and are not sure where it belongs, the answer
is in [§9 Where do I put…?](#9-where-do-i-put).

For *why* the architecture is shaped this way and what is still being ported,
see [MICROSERVICES-BLUEPRINT.md](MICROSERVICES-BLUEPRINT.md). This document is
the *layout*, not the plan.

---

## Table of contents

1. [The three tiers](#1-the-three-tiers)
2. [Top-level layout](#2-top-level-layout)
3. [Anatomy of a service](#3-anatomy-of-a-service)
4. [Anatomy of a module](#4-anatomy-of-a-module) ← the important one
5. [The module manifest contract](#5-the-module-manifest-contract)
6. [The four audiences and where routes land](#6-the-four-audiences-and-where-routes-land)
7. [Layer rules — what may import what](#7-layer-rules--what-may-import-what)
8. [The shared packages](#8-the-shared-packages)
9. [Where do I put…?](#9-where-do-i-put)
10. [Recipe: add a new module](#10-recipe-add-a-new-module)
11. [Recipe: add a new service](#11-recipe-add-a-new-service)
12. [Recipe: add a model / migration](#12-recipe-add-a-model--migration)
13. [Tests](#13-tests)
14. [Naming conventions](#14-naming-conventions)
15. [Rules that are enforced at boot](#15-rules-that-are-enforced-at-boot)

---

## 1. The three tiers

Everything in this repo is one of three things. Getting this right is 90% of
knowing where a file goes.

```
┌──────────────────────────────────────────────────────────────┐
│  gateway/          THE EDGE                                  │
│  One public port. Verifies the token, strips spoofed          │
│  headers, proxies to a service. Owns NO business logic.       │
└──────────────────────────────────────────────────────────────┘
                              │ proxies to
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  services/         THE BUSINESS                              │
│  user · admin · casino · sports                              │
│  Each is a process. Each owns a set of MODULES.              │
│  All domain logic lives here and nowhere else.               │
└──────────────────────────────────────────────────────────────┘
                              │ builds on
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  packages/         THE FOUNDATION                            │
│  common · db · auth · socket                                 │
│  Domain-agnostic. Knows nothing about bets, wallets or KYC.  │
└──────────────────────────────────────────────────────────────┘
```

**The one-line test for `packages/` vs `services/`:**
> Would this code be identical on a completely different product?
> Yes → `packages/`. No → the service that owns it.

A retry-with-circuit-breaker HTTP client is `packages/common`. A *wallet* client
that knows about `credits` and `ledger` is *also* `packages/common` — but only
because four services call it and there must be exactly one implementation of
money movement. Absent that pressure, it would live in `services/user`.

### The ports

| Process | Port | Start command |
|---|---:|---|
| gateway | 4000 | `npm run start:gateway` |
| user-service | 4001 | `npm run start:user` |
| admin-service | 4002 | `npm run start:admin` |
| casino-service | 4003 | `npm run start:casino` |
| sports-service | 4004 | `npm run start:sports` |
| sports worker | 4104 | `npm run start:sports-worker` |

`npm run dev` spawns all of them ([scripts/dev.js](../scripts/dev.js)).
`npm run dev:mono` runs the identical modules inside **one** process
([scripts/dev-mono.js](../scripts/dev-mono.js)) — see §5 for why that works.

---

## 2. Top-level layout

```
backend/
├── package.json              npm workspaces: packages/* services/* gateway
├── .env / .env.example       ONE env file for every process
│
├── gateway/                  the public edge (§3.6)
│   ├── package.json
│   └── src/
│       ├── index.js          boot
│       ├── app.js            middleware stack
│       ├── config.js         validated env
│       ├── proxy.js          service routing table
│       ├── legacyRoutes.js   fall-through to legacy/ during the port
│       ├── health.js
│       └── middleware/
│           ├── verifyToken.js    verify once, at the edge
│           └── stripHeaders.js   client cannot forge x-user-id
│
├── packages/                 shared, domain-agnostic (§8)
│   ├── common/               createApp, errors, money, ServiceClient, mw
│   ├── db/                   Sequelize, 163 models, migrations, seeders
│   ├── auth/                 JWT, bcrypt, TOTP, RBAC
│   └── socket/               socket.io server wrapper, wire format
│
├── services/                 the business (§3)
│   ├── user/                 wallet, auth, payments, KYC, bonus, P2P…
│   ├── admin/                staff, RBAC, banners, reports, site-config…
│   ├── casino/               providers, games, bets, seamless wallet…
│   └── sports/               feed, bets, exposure, settlement, results
│
├── scripts/                  process launchers + one-off ops scripts
│   ├── dev.js                spawn all six processes
│   ├── dev-mono.js           all modules in one process
│   ├── rebuild-exposures.js
│   └── seed-test-logins.js
│
├── tools/                    static analysis / verification (no DB writes)
│   ├── verify-modules.js     mount every module, print the route table
│   ├── route-inventory.js    legacy → new port tracker
│   ├── verify-models.js      diff models against the live schema
│   ├── socket-inventory.js
│   └── check-secrets.js
│
└── docs/                     this file and its siblings
```

**`scripts/` vs `tools/`:** `scripts/` *runs* the system (launchers, data
backfills, seeds). `tools/` *inspects* it (inventories, verifiers, generators)
and must be safe to run against any checkout.

---

## 3. Anatomy of a service

Every service is the same six files plus a `modules/` folder. Use
[services/sports/](../services/sports/) as the reference.

```
services/<name>/
├── package.json              @ibitplay/<name>-service
└── src/
    ├── index.js              ① boot + graceful shutdown
    ├── config.js             ② validated env, exported as a frozen object
    ├── container.js          ③ dependency injection root
    ├── app.js                ④ assemble Express, mount modules, set guards
    ├── sockets.js            ⑤ socket.io transport (optional)
    ├── worker.js             ⑥ background job host (optional — sports only)
    └── modules/              ⑦ ALL business logic (§4)
        ├── settlement/
        ├── bets/
        └── feed/
```

### ① `src/index.js` — boot

Create container → build app → `startServer()` → attach sockets. That is all.
Never put logic here.

```js
async function main() {
  const container = await createContainer();
  const app = buildApp(container);
  const { server } = startServer({
    app, port: config.PORT, serviceName: config.SERVICE_NAME,
    logger: container.logger,
    onShutdown: [() => container.close()],   // DB closes AFTER in-flight requests
  });
  attachSockets({ server, container });
}
```

### ② `src/config.js` — env

Compose the shared shapes, then add this service's own variables. Validated
**once at boot**, so a missing variable stops the process with a readable list
instead of throwing on the first request that needs it.

```js
const config = loadEnv({
  ...httpEnvShape, ...dbEnvShape, ...jwtEnvShape, ...serviceDiscoveryEnvShape,
  SPORTS_SERVICE_PORT: coercers.int(4004),
  SPORTS_FEED_URL: coercers.str(),        // no default = required, fail at boot
}, { serviceDir: path.resolve(__dirname, '..') });

config.SERVICE_NAME = 'sports-service';
config.PORT = config.SPORTS_SERVICE_PORT;
```

> **Rule:** a secret or upstream URL gets **no default**. A deployment that
> forgot it should refuse to start, not start and serve wrong data.

### ③ `src/container.js` — dependency injection

The single place upstreams are constructed. Everything a module could need is
assembled here and handed to router factories as `deps`.

The standard container shape:

| Key | What it is |
|---|---|
| `config`, `logger` | validated env, pino logger |
| `db`, `models` | the Sequelize connection and its registered models |
| `clients` | `ServiceClient` per upstream service (retry + circuit breaker) |
| `wallet` | `WalletClient` — **the only** way a non-user service moves money |
| `auth` | `createAuthMiddleware({ loadUser, loadStaff })` |
| `cache` | Redis when configured, heap Map with a warning otherwise |
| `close()` | shutdown hook |

> **Rule:** a module **never** `require`s the database, a client or config
> directly. It receives them. That is what makes a module testable against a
> fake container, and what lets `dev:mono` swap `clients.user` for an
> in-process dispatcher.

### ④ `src/app.js` — assembly

Loads modules from disk, decides **what each audience must prove**, hands both
to `mountModules`. Adding a feature means adding a folder under `modules/` —
never editing this file.

```js
const modules = loadModules(path.join(__dirname, 'modules'), { logger });

routes.use(createHealthRouter({ serviceName, checks: { database: () => db.ping() } }));
routes.use(mountModules({
  modules, deps: container, logger,
  guards: {
    public:   [],
    user:     [auth.authenticate(), auth.requireActive({ checkBetting: true })],
    admin:    [auth.authenticateStaff()],
    internal: [internalAuth(config.INTERNAL_API_KEY)],
  },
}));
```

### ⑤ `src/sockets.js` — transport

Creates the `socket.io` server, authenticates handshakes with the **shared**
`TokenService`, and registers each module's `sockets.js`. Handlers themselves
live in the module, not here:

```js
const SOCKET_MODULES = [require('./modules/feed/sockets')];
```

> **Rule:** a service owns the sockets that touch the things it owns. Do not
> put a casino socket handler in user-service because "the user is there".

### ⑥ `src/worker.js` — background jobs

A second process that mounts **no routers** and runs only the `jobs` declared
in module manifests. Same modules, different host — which is why settlement
logic is reachable from both HTTP and cron without being written twice.

---

## 4. Anatomy of a module

**A module is a feature folder that is self-contained.** This is where you will
spend all of your time. Reference implementations:
[services/sports/src/modules/settlement/](../services/sports/src/modules/settlement/) and
[services/user/src/modules/wallet/](../services/user/src/modules/wallet/).

```
modules/<module-name>/
├── index.js                        ① MANIFEST — the only required file
│
├── routes/                         ② HTTP surface, one file per audience
│   ├── public.routes.js
│   ├── user.routes.js
│   ├── admin.routes.js
│   └── internal.routes.js
│
├── controllers/                    ③ HTTP ⇄ service translation
│   ├── user.controller.js
│   ├── admin.controller.js
│   └── internal.controller.js
│
├── <module>.service.js             ④ BUSINESS RULES
├── <module>.repository.js          ⑤ DATABASE ACCESS
├── <module>.validators.js          ⑥ zod schemas, one per endpoint
├── <module>.errors.js              ⑦ error taxonomy
├── <module>.constants.js           ⑧ enums, magic strings, statuses
│
├── <module>.jobs.js                ⑨ optional — background jobs
├── sockets.js                      ⑩ optional — socket handlers
│
└── __tests__/                      ⑪ tests live WITH the module
    ├── <module>.service.test.js
    └── <module>.routes.test.js
```

Each layer has exactly one job. The value of the structure is that each layer
is *forbidden* the others' jobs.

### ② `routes/*.routes.js` — wiring only

A **factory** `(deps) => Router`. Builds the service, builds the controller,
declares paths. No logic, no auth (the loader attaches guards), no `try/catch`.

```js
module.exports = function userRoutes(deps) {
  const service = new SettlementService(deps);
  const ctrl = createUserController({ service });

  const router = Router();
  router.get('/my-settled-bets', validate(v.listMySettledBets), ctrl.listMySettledBets);
  return router;
};
```

> **Rule:** export the **factory**, not a built Router. The loader throws at
> boot if you export a Router. This is what allows the same module to be
> mounted twice against two different containers in a test.

### ③ `controllers/*.controller.js` — translation

Read `req`, call one service method, shape the response. Every handler wrapped
in `asyncHandler`. No business decisions, no SQL, no `if` on domain state.

```js
function createUserController({ service }) {
  return {
    listMySettledBets: asyncHandler(async (req, res) => {
      const result = await service.listSettledBetsForUser({
        userId: req.user.id,          // from the verified token, NEVER req.query
        matchId: req.query.match_id,
      });
      return response.paginated(res, result, { page, limit });
    }),
  };
}
```

> **Rule:** the acting user id comes from `req.user.id`. Taking it from the
> query string is the difference between "my settled bets" and "any user's
> settled bets if you know their id".

**Why one controller per audience:** the same service method serves a player
and an operator with different inputs, different response shapes, and different
authority. Splitting them makes it impossible to accidentally expose an admin
field to a player.

### ④ `<module>.service.js` — the business rules

**No `req`, no `res`, no SQL.** A plain class constructed from the container.
This is why the background worker can call `settleMarket()` directly instead of
making an HTTP request to its own process.

```js
class SettlementService {
  constructor({ models, db, config, logger, clients }) {
    this.repo = new SettlementRepository({ models, db });
    this.db = db;
  }

  async settleMarket(input) {
    return this.db.transaction(async (tx) => { /* … */ });   // real pooled tx
  }
}
```

> **Rule:** every multi-row write runs inside `db.transaction(...)`. The legacy
> code issued `BEGIN` on a *shared* client, so one request's transaction could
> wrap another's queries.

### ⑤ `<module>.repository.js` — data access

Every database call the module makes, in one file. Sequelize against registered
models. Knows nothing about HTTP, decides no policy — it reads and writes rows,
takes the locks it is told to take, and returns plain objects.

`literal()` is permitted only for expressions Sequelize cannot build, and never
with interpolated user input.

### ⑥ `<module>.validators.js` — input schemas

One zod schema per endpoint, named after the handler that uses it. `validate()`
**replaces** `req.body`/`query`/`params` with the parsed result, so an extra
field in the body cannot reach the database.

```js
const paging = z.object({
  limit:  z.coerce.number().int().min(1).max(500).default(100),  // cap it
  offset: z.coerce.number().int().min(0).default(0),
});
```

> **Rule:** always cap `limit`. `?limit=999999` on an aggregate is a trivial way
> to pin a database connection for minutes.

### ⑦ `<module>.errors.js` — the failure taxonomy

`defineErrors('<PREFIX>', {...})` — each case gets a real HTTP status and a
stable code the frontend can branch on. Anything *unexpected* falls through to
the shared error handler as a generic 500 with the stack logged, not returned.

```js
module.exports = defineErrors('SETTLEMENT', {
  MARKET_NOT_FOUND: { status: 404, message: '…' },
  NO_OPEN_BETS:     { status: 409, message: '…' },
});
```

### ⑧ `<module>.constants.js`

Statuses, enums, ledger reasons, market types. If a string literal appears in
two files, it belongs here.

---

## 5. The module manifest contract

`index.js` is the **entire** contract between a module and its host process.
Because nothing in it names a port, a prefix or a guard, the same folder runs
unchanged in three places: the microservice, the combined monolith
(`dev:mono`), and the background worker.

```js
module.exports = {
  name: 'settlement',            // required — unique within the service
  service: 'sports',             // required — owning service
  basePath: '/settlement',       // required — must start with '/'

  models: ['sports', 'core'],    // db domains this module touches

  routers: {                     // required (unless socketOnly)
    public:   require('./routes/public.routes'),     // (deps) => Router
    user:     require('./routes/user.routes'),
    admin:    require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },

  socketOnly: false,             // set true if the module has no HTTP surface

  jobs: [                        // optional — run by worker.js only
    { name: 'feed:events', intervalMs: 60_000, immediate: true,
      run: (container) => require('./feed.jobs').createEventsJob(container)() },
  ],
};
```

**Discovery:** a folder under `modules/` is a module if it contains `index.js`.
Prefix a folder with `_` to keep it on disk but unmounted — the escape hatch
for work in progress.

---

## 6. The four audiences and where routes land

The module declares **which** audiences it serves. `app.js` decides **what each
must prove**. The loader — not the module — attaches the guard, so a module
*cannot forget its auth*.

| Router key | Mounted at | Guard |
|---|---|---|
| `public` | `/api/v1/<service><basePath>` | none |
| `user` | `/api/v1/<service><basePath>` | player token + active check |
| `admin` | `/api/v1/admin/<service><basePath>` | staff token + permissions |
| `internal` | `/internal/<service><basePath>` | internal API key only |

Worked example — `settlement` in `sports`, `basePath: '/settlement'`:

```
GET /api/v1/sports/settlement/my-settled-bets          user
GET /api/v1/admin/sports/settlement/markets            admin
PST /internal/sports/settlement/settle                 internal
```

admin-service's own modules collapse the repeated segment: `service: 'admin'`
gives `/api/v1/admin/<basePath>`, not `/api/v1/admin/admin/<basePath>`.

> **`internal` is not public.** It is never routed through the gateway. It is
> the service-to-service surface, reachable only with `INTERNAL_API_KEY`.
> Cross-service reads go here — a service may not read another service's tables.

---

## 7. Layer rules — what may import what

```
routes/  ──→  controllers/  ──→  service  ──→  repository  ──→  models
   │              │                 │              │
   └──→ validators│                 └──→ errors    └──→ @ibitplay/db
                  └──→ errors            └──→ clients / wallet (other services)
```

**Allowed:**

- Any layer → `@ibitplay/common`, `@ibitplay/auth`, `@ibitplay/db`
- service → `clients.<other>` and `wallet` (cross-service, over the internal API)
- service → its own repository
- Any layer → its own module's `constants` / `errors`

**Forbidden — and each has bitten this codebase before:**

| Don't | Why |
|---|---|
| `require` another **module's** internals | Cross the boundary via the service layer or an internal route |
| SQL in a service or controller | Repository only — one place to audit |
| `req` / `res` in a service | Kills worker reuse and testability |
| A service writing another service's tables | Money moves through `WalletClient`, once |
| `process.env` outside `config.js` | Nothing validates it; boot cannot fail early |
| Auth checks inside a route file | The loader owns guards; per-file auth is how routes end up unguarded |
| Business logic in `gateway/` | The gateway proxies; it does not decide |

---

## 8. The shared packages

### `packages/common` — the foundation

| File | Provides |
|---|---|
| `createApp.js` | the shared middleware stack, in the order that matters |
| `server.js` | `startServer` + graceful shutdown (drain, *then* close DB) |
| `moduleLoader.js` | `loadModules` / `mountModules` / `collectJobs` |
| `env.js` | `loadEnv`, `coercers`, the reusable env shapes |
| `errors.js`, `defineErrors.js` | error taxonomy + per-module error factories |
| `response.js` | the response envelope (`ok`, `paginated`, …) |
| `serviceClient.js` | HTTP client: retry, circuit breaker, request-id propagation |
| `walletClient.js` | **the** money interface for non-user services |
| `money.js` | exact decimal arithmetic — never use floats for balances |
| `cache.js` | Redis, or a heap Map with a loud warning |
| `logger.js`, `mailer.js`, `imageUpload.js`, `vipLevels.js` | shared utilities |
| `middleware/` | requestContext, validate, rateLimit, internalAuth, errorHandler, notFound, activity |

### `packages/db` — the data layer

```
packages/db/
├── src/
│   ├── index.js              connect() → { models, transaction, lockRow, ping }
│   ├── sequelize.js          pool construction
│   ├── BaseRepository.js     shared repository helpers
│   ├── transaction.js        withTransaction, lockRow, advisory locks
│   ├── migrator.js  cli.js   db:migrate / db:seed / db:status / db:verify
│   └── models/
│       ├── index.js          DOMAINS + SERVICE_DOMAINS registry
│       ├── associations.js   ALL relations, in one file
│       ├── core/             40 — users, credits, ledger, clubs, chat
│       ├── casino/           44 — providers, games, sessions, bets
│       ├── admin/            15 — staff, roles, banners, site config
│       ├── payments/         13 — deposits, withdrawals, PSP
│       ├── sports/           14 — matches, markets, exposure
│       └── extended/         37 — post-baseline, hand-written tables
├── migrations/               000…034, numbered, never edited once shipped
├── seeders/                  001-roles-and-admin, 002-inhouse-games
└── 000_baseline_schema.sql   the 132-table starting point
```

**Which service loads which domains** (`SERVICE_DOMAINS`) — a service only
registers the models it owns; anything else is an HTTP read:

| Service | Domains |
|---|---|
| user-service | `core`, `payments`, `extended` |
| casino-service | `casino`, `core`, `extended` |
| sports-service | `sports`, `core`, `extended` |
| admin-service | all six (it reports across the platform) |
| gateway | none |

### `packages/auth`

`tokens.js` (player/refresh/staff JWTs), `password.js` (bcrypt), `totp.js` (2FA),
`middleware.js` (`authenticate`, `requireActive`, `requirePermission`,
`authenticateStaff`), `permissions.js` (the RBAC map).

### `packages/socket`

`createSocketServer.js`, `wire.js` (the event envelope), `rateLimit.js`,
`events.js`, `socket.errors.js`. Module handlers stay in the module.

---

## 9. Where do I put…?

| I need to add… | It goes in |
|---|---|
| A new API endpoint on an existing feature | `modules/<m>/routes/<audience>.routes.js` + a controller method |
| A new business rule | `modules/<m>/<m>.service.js` |
| A new query | `modules/<m>/<m>.repository.js` |
| A whole new feature | a new folder in `services/<svc>/src/modules/` → §10 |
| A new status / enum / magic string | `modules/<m>/<m>.constants.js` |
| A new failure case | `modules/<m>/<m>.errors.js` |
| Input validation | `modules/<m>/<m>.validators.js` |
| A cron / interval job | `modules/<m>/<m>.jobs.js` + `jobs:` in the manifest |
| A socket event | `modules/<m>/sockets.js` + register in `services/<svc>/src/sockets.js` |
| A config variable | `services/<svc>/src/config.js` **and** `.env.example` |
| A new upstream service call | `services/<svc>/src/container.js` (`clients`) |
| A new database table | `packages/db/migrations/NNN-*.js` + a model → §12 |
| A relation between models | `packages/db/src/models/associations.js` |
| A helper used by 2+ modules in **one** service | `services/<svc>/src/shared/` (create it) |
| A helper used by 2+ **services** | `packages/common/src/` |
| A cross-service read | an `internal` route on the owner + `clients.<owner>` on the caller |
| Anything that moves a balance | `WalletClient` — never write `credits` directly |
| A one-off data fix | `scripts/` |
| A verification / inventory tool | `tools/` |
| A new service | `services/<name>/` → §11 |

---

## 10. Recipe: add a new module

Adding `promotions` to user-service.

**1. Create the folder**

```bash
mkdir -p services/user/src/modules/promotions/{routes,controllers,__tests__}
```

**2. `promotions.constants.js`** — statuses and enums first, so nothing else
hardcodes a string.

**3. `promotions.errors.js`**

```js
const { defineErrors } = require('@ibitplay/common');
module.exports = defineErrors('PROMOTIONS', {
  PROMO_NOT_FOUND: { status: 404, message: 'Promotion not found' },
  ALREADY_CLAIMED: { status: 409, message: 'This promotion is already claimed' },
});
```

**4. `promotions.repository.js`** — every query, Sequelize only.

**5. `promotions.service.js`** — the rules. Constructor takes the container.

**6. `promotions.validators.js`** — one zod schema per endpoint, `limit` capped.

**7. `controllers/user.controller.js`** — `asyncHandler`, `req.user.id`,
`response.*`.

**8. `routes/user.routes.js`** — the `(deps) => Router` factory.

**9. `index.js`** — the manifest:

```js
module.exports = {
  name: 'promotions',
  service: 'user',
  basePath: '/promotions',
  models: ['core'],
  routers: { user: require('./routes/user.routes') },
};
```

**10. Verify it mounted**

```bash
npm run verify:modules     # prints every mounted route, no DB needed
```

You did **not** touch `app.js`, `index.js`, `container.js` or the gateway. That
is the property this structure exists to protect.

---

## 11. Recipe: add a new service

Only when a domain has its own scaling profile, its own upstream, or its own
failure blast radius. Otherwise add a module.

1. `services/<name>/package.json` — name it `@ibitplay/<name>-service`, depend
   on `@ibitplay/common`, `@ibitplay/db`, `@ibitplay/auth`.
2. Copy the six `src/` files from [services/sports/src/](../services/sports/src/)
   and change the service name, port and env shape.
3. Add the domain list to `SERVICE_DOMAINS` in
   [packages/db/src/models/index.js](../packages/db/src/models/index.js).
4. Add `<NAME>_SERVICE_PORT` and `<NAME>_SERVICE_URL` to `.env.example`.
5. Register the route prefix in [gateway/src/proxy.js](../gateway/src/proxy.js).
6. Add `start:<name>` to the root `package.json` and to `scripts/dev.js`.
7. `npm install` (workspaces picks it up automatically).

---

## 12. Recipe: add a model / migration

1. **Migration** — `packages/db/migrations/035-<what>.js`. Numbered, sequential.
   Once a migration has run anywhere, it is immutable: fix it with a *new* one.
2. **Model** — `packages/db/src/models/<domain>/<PascalCase>.js`.
3. **Register** — export it from that domain's `index.js`.
4. **Associate** — add relations to `models/associations.js`, never inside a
   model file.
5. **Declare** — add the domain to the consuming module's `models: []`.
6. **Verify**

```bash
npm run db:migrate
npm run verify:models     # diffs every model against the real schema
```

New tables added after the baseline that no generated domain owns go in
`models/extended/`.

---

## 13. Tests

Tests live **with the code they test**, never in a top-level `test/` tree.

```
packages/common/__tests__/response.test.js
services/<svc>/src/modules/<m>/__tests__/<m>.service.test.js
```

```bash
npm test                    # everything (node:test, no framework)
node --test services/user/src/modules/wallet/__tests__/wallet.money.test.js
```

Most tests need no database — construct the service with a fake container. The
money tests are the deliberate exception and run against a real PostgreSQL,
because row locking and ledger integrity cannot be verified against a mock:

```bash
createdb ibitplay_test && DB_NAME=ibitplay_test node packages/db/src/cli.js migrate
```

Verification commands that are not tests:

```bash
npm run verify:modules    # mount every module, print the route table
npm run verify:routes     # legacy port progress
npm run verify:models     # models vs. live schema (needs a DB)
npm run verify:sockets    # socket event inventory
npm run verify:secrets    # no committed credentials
```

---

## 14. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Service folder | lowercase, single word | `services/casino/` |
| Module folder | lowercase, kebab-case | `modules/bet-history/` |
| Layer file | `<module>.<layer>.js` | `wallet.service.js` |
| Route file | `<audience>.routes.js` | `admin.routes.js` |
| Controller file | `<audience>.controller.js` | `internal.controller.js` |
| Model file | `PascalCase` singular-ish, matches the table | `CreditsLedger.js` |
| Migration | `NNN-kebab-description.js` | `034-siteconfig-sports-flag.js` |
| Error prefix | `SCREAMING_SNAKE`, module-scoped | `SETTLEMENT_MARKET_NOT_FOUND` |
| Env variable | `SCREAMING_SNAKE`, service-prefixed | `SPORTS_FEED_URL` |
| npm package | `@ibitplay/<name>` | `@ibitplay/common` |
| Unmounted module | `_` prefix | `modules/_draft-feature/` |

Ported endpoints carry a `@legacy` JSDoc tag naming the old route — that tag is
what `npm run verify:routes` counts:

```js
/** @legacy GET /api/internalsettle/momatches */
```

---

## 15. Rules that are enforced at boot

These are not style guidelines. The process **refuses to start** if you break
them — the failures they prevent are all ones the legacy codebase shipped.

| Violation | Thrown by |
|---|---|
| Manifest missing `name` / `service` / `basePath` / `routers` | `validateManifest` |
| `basePath` not starting with `/` | `validateManifest` |
| Unknown router key (not one of the four audiences) | `validateManifest` |
| A router exported as a built Router instead of a factory | `validateManifest` |
| A module with no routers and no `socketOnly: true` | `validateManifest` |
| A `user` / `admin` / `internal` surface with no guard supplied | `mountModules` |
| A factory that does not return a Router | `mountModules` |
| A missing or malformed env variable | `loadEnv` |

And two enforced at runtime rather than boot: `RATE_LIMIT_ENABLED=false` logs a
standing warning, and the shared cache logs loudly when it falls back from Redis
to an in-heap Map.

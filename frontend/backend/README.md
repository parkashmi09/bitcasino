# iBitPlay — Backend Platform

Casino and sportsbook backend: four Express microservices behind an API
gateway, on Sequelize + PostgreSQL, with a Socket.io surface on all four.

The previous monolith is kept in `legacy/` as the reference this port is
measured against. It is not deployed and not on the require path.

|  |  |
| --- | ---: |
| Services | 4 + gateway |
| Modules | 66 |
| HTTP routes | 568 |
| Socket events | 78 |
| Legacy HTTP ported | 555 / 577 (96.2%) |
| Legacy sockets ported | 77 / 79 (97.5%) |
| Models | 163 |
| Migrations | 37 |
| Tests | 1095 |

Every number above is a verifier's output, not a claim. `npm run verify:*`
reproduces each one.

---

## Quick start

```bash
npm run setup      # .env + secrets, install, create, migrate, seed, verify
npm run dev        # gateway + all four services
```

`npm run setup` asks for your Postgres details (enter accepts every default) and
does the rest: it writes `.env`, generates all eight secrets, fills the two
variables the services require that `.env.example` leaves unset, creates the
database, runs the migrations and seeds. It is safe to re-run — real values in
an existing `.env` are never overwritten.

Want accounts to log in with? `npm run setup:demo` adds a staff tree, players
with balances and some content, and prints the credentials.

Full detail, flags and troubleshooting: **[docs/SETUP.md](docs/SETUP.md)**.

The gateway is then on **http://127.0.0.1:4000**.

```bash
curl localhost:4000/health     # aggregated platform health
curl localhost:4000/api/v1     # endpoint index
```

Requires Node ≥ 20 and PostgreSQL ≥ 14.

> **Before production, read [docs/ROTATION.md](docs/ROTATION.md).** Sixteen
> credentials are committed in `legacy/`, including the JWT secret that signs
> every player session — anyone with a copy of this repository can mint a token
> for any account. Nothing else on any list matters until those are rotated.

---

## Documentation

| Document | What it is |
| --- | --- |
| **[docs/SETUP.md](docs/SETUP.md)** | Getting this running on a machine that has never seen it — setup, the data runner, and what to do when it goes wrong |
| **[docs/STRUCTURE.md](docs/STRUCTURE.md)** | The layout reference — where every kind of file goes, the module anatomy, and the recipes for adding one |
| **[docs/API-ROUTES.md](docs/API-ROUTES.md)** | The HTTP reference — routing model, audiences, auth, envelope, every module and where to call it |
| **[docs/SOCKET-API.md](docs/SOCKET-API.md)** | The socket reference — connecting, wire format, every event and its audience |
| **[docs/SOCKETS.md](docs/SOCKETS.md)** | The socket *audit* — what the legacy transport did, and what it cost |
| **[docs/ROTATION.md](docs/ROTATION.md)** | Every committed credential, what it opens, the order to rotate in |
| [docs/LEGACY-PORT.md](docs/LEGACY-PORT.md) | The port's findings, module by module |
| [docs/MICROSERVICES-BLUEPRINT.md](docs/MICROSERVICES-BLUEPRINT.md) | Why the service boundaries are where they are |
| [docs/BETTING-LOGIC.md](docs/BETTING-LOGIC.md) | Exposure, settlement, and the money rules |
| [docs/ROUTE-PORT-CHECKLIST.md](docs/ROUTE-PORT-CHECKLIST.md) | *Generated* — every legacy route, ported or not |

`ROUTE-PORT-CHECKLIST.md` and the appendix of `API-ROUTES.md` are written by
`node tools/route-inventory.js`. Do not hand-edit them.

---

## Architecture

```text
                        ┌──────────────────────┐
   clients ────────────▶│   gateway  :4000     │  edge auth, rate limit,
                        │                      │  legacy path rewrites, health
                        └──────────┬───────────┘
                     ┌─────────────┼─────────────┬──────────────┐
                     ▼             ▼             ▼              ▼
              ┌────────────┐ ┌───────────┐ ┌───────────┐ ┌────────────┐
              │   user     │ │   admin   │ │  casino   │ │   sports   │
              │   :4001    │ │   :4002   │ │   :4003   │ │   :4004    │
              │  +sockets  │ │ +sockets  │ │ +sockets  │ │  +sockets  │
              └─────┬──────┘ └─────┬─────┘ └─────┬─────┘ └──────┬─────┘
                    │  ▲           │             │              │
                    │  └───────────┴─────────────┴──────────────┘
                    │            internal API (x-internal-key)
                    │            every balance change routes here
                    ▼
              ┌───────────────────────────────────────────────┐
              │      PostgreSQL — one database, 165 tables (163 models)    │
              └───────────────────────────────────────────────┘
```

### Services

| Service | Port | Modules | Owns | Responsibilities |
| --- | ---: | ---: | --- | --- |
| **gateway** | 4000 | — | — | Single public entry point. Verifies player tokens once, strips spoofable headers, routes by prefix, refuses to proxy `/internal/*`, rewrites legacy paths, aggregates health. |
| **user** | 4001 | 30 | `users`, `credits`, `credits_ledger`, `auth_*`, `p2p_*` | Registration, login, 2FA, sessions, profile, P2P trading, **wallet + ledger**. The only service that writes a balance. |
| **admin** | 4002 | 16 | `staff`, `roles`, banners, blogs, activity logs | Staff auth, RBAC, agent hierarchy, player administration, reports, site content, audit trail. |
| **casino** | 4003 | 13 | `bets`, catalogue, fairness seeds, aggregator sessions | Game catalogue, four provider integrations, 20 in-house games, settlement. |
| **sports** | 4004 | 7 | `SportsBet`, `user_exposures` | Fixtures, bet placement, exposure/liability, match settlement. |
| **sports-worker** | 4104* | — | — | Background jobs: feed polling, result polling, settlement, housekeeping. Separate process. *(health port only)* |

### Shared packages

| Package | Contents |
| --- | --- |
| `@ibitplay/common` | Env loading + validation, logger, error taxonomy, module loader, middleware (request context, validation, rate limit, error handler, internal auth, activity), response envelope, `ServiceClient`, `WalletClient`, exact-decimal `money`, image upload |
| `@ibitplay/db` | Sequelize connection, **163 models** across six domains, associations, 37 migrations, seeders, transaction/locking helpers |
| `@ibitplay/auth` | JWT (player / refresh / staff), bcrypt, TOTP 2FA, `authenticate` / `requireActive` / `requirePermission`, RBAC |
| `@ibitplay/socket` | Socket.io transport, the 157-name wire table, audience guards, per-event rate limiting |

Mail is `@ibitplay/common/mailer`; push lives in admin-service's `notifications`
module, next to the tables it writes. Neither needed a package of its own.

---

## Layout

```text
ibitplay/
├── gateway/                  Public edge — routes, rate limits, legacy rewrites
├── services/{user,admin,casino,sports}/
├── packages/{common,db,auth,socket}/
├── scripts/                  Operator scripts (dev runner, exposure rebuild)
├── tools/                    Verifiers — routes, models, sockets, modules, secrets
├── docs/                     The documents listed above
├── legacy-hotfix/            Applied patch for the live legacy box
└── legacy/                   The old monolith. Reference only.
```

**`legacy/` is a SIBLING of `backend/`, not a child.** The repository root holds
exactly two things — this backend and the monolith it replaces:

```text
ibitplay/
├── backend/     ← everything below this line, and where you run npm
└── legacy/      ← reference only, never deployed, not on the require path
```

`tools/route-inventory.js`, `tools/socket-inventory.js` and the socket event
test read `legacy/` from one level above the backend. Run every command from
`backend/`.

### Inside a service

```text
services/<service>/src/
├── index.js                  Boot: container → app → server → sockets
├── app.js                    Express app, module mounting
├── container.js              Database, logger, clients, config — built once
├── config.js                 This service's env shape
├── sockets.js                Socket.io transport
└── modules/<module>/
    ├── index.js              The descriptor — name, basePath, routers, models
    ├── <module>.service.js   The logic. No Express, no SQL strings.
    ├── <module>.validators.js  zod shapes, `.strict()`
    ├── <module>.errors.js    `defineErrors('NAMESPACE', {...})`
    ├── <module>.constants.js Every literal that appeared twice
    ├── controllers/          Thin — unwrap the request, call the service
    ├── routes/               public | user | admin | internal
    ├── sockets.js            Socket events, if the module has any
    └── __tests__/            Against a real PostgreSQL
```

One folder per module, user-side and admin-side together. A module is
self-contained: its errors, validators, constants and tests live beside it, and
nothing outside needs to know how it works.

---

## The module system

A module declares itself. It never mounts itself.

```js
// services/user/src/modules/vault/index.js
module.exports = {
  name: 'vault',
  service: 'user',
  basePath: '/vault',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
```

The four router keys are the four **audiences**, and the loader — not the module
— attaches the guard for each:

| Audience | Mounts at | Guard |
| --- | --- | --- |
| `public` | `/api/v1/<service><basePath>` | none |
| `user` | `/api/v1/<service><basePath>` | player token |
| `admin` | `/api/v1/admin/<service><basePath>` | staff token + permission |
| `internal` | `/internal/<service><basePath>` | internal key, never proxied |

**`public` is an audience, not a path segment.** A public router and a user
router mount at the same path — one carries a guard, the other does not.

A module that declares `user`, `admin` or `internal` routes and is mounted
without the matching guard **fails at boot**. It cannot serve an unauthenticated
admin route, because a handler never performs its own auth check. That is the
property the whole loader exists for: in the source this replaces, the guard was
a line you remembered to type, and the routes where somebody forgot are most of
`docs/LEGACY-PORT.md`.

`socketOnly: true` permits `routers: {}`, for a module whose entire surface is
socket events. Without the flag an empty `routers` is rejected — a module whose
routes silently do not mount is a far more common mistake than a deliberately
socket-only one.

---

## Conventions

**No raw SQL outside migrations.** Every read and write goes through a Sequelize
model. `UPDATE credits SET ${coin} = ...` — a request value interpolated as a
column name — appeared four times in the legacy source; the wallet takes a
currency *code* and resolves the column through its own allow-list.

**Money is an exact decimal string.** `@ibitplay/common/money` converts to
`BigInt` minor units and back. `0.1 + 0.2` is `0.30000000`, not
`0.30000000000000004`. No float ever touches a balance.

**Every debit is a guarded UPDATE** — `WHERE balance >= amount` — and the row
count is the answer. Postgres decides, not a JavaScript comparison a concurrent
request could invalidate.

**Every money movement writes a ledger row** and carries an idempotency key
derived from the thing being paid for, so a retry returns the original movement
rather than paying twice.

**Errors are declared.** `defineErrors(namespace, defs)` builds them with a
status and a stable code, and detects duplicates at boot.

**Validators are `.strict()`.** An unrecognised field is a 400, not something
silently ignored — which is how `user_id` in a request body became an account
takeover in the source this replaces.

**`@legacy` tags are the map.** Every ported handler carries
`@legacy METHOD /path` or `@legacy SOCKET <wire-name>`. The inventory tools read
them, which is where the coverage numbers come from — counted, not estimated.

---

## Design decisions

**One database, not one per service.** A sports bet must debit a wallet in a
single transaction. Splitting those across databases trades a real ACID
guarantee for a distributed-transaction problem. The split is at the *service*
boundary: exactly one service writes a given table, and the others go through
its API.

Each service loads only the domains it owns:

| Service | Domains |
| --- | --- |
| user | `core`, `payments`, `extended` |
| admin | all six |
| casino | `casino`, `core`, `extended` |
| sports | `sports`, `core`, `extended` |

**All money moves through user-service.** Casino and sports never touch
`credits`. They call `POST /internal/user/wallet/debit` and `/credit`, so the row
locking, ledger writes and idempotency rules exist in exactly one place.

**Row locks, not read-then-write.** Every balance change takes
`SELECT … FOR UPDATE` before reading, and the `UPDATE` carries its own guard. Ten
concurrent debits of 20 against a balance of 100 produce exactly five successes —
covered by a test.

**Compensating refunds.** A stake is debited before the round resolves. If
anything after that fails, the stake is refunded and the ledger records why. A
refund that itself fails is logged at `fatal` with everything needed to
reconcile by hand, rather than being swallowed.

**Two token families, two secrets.** A leaked player secret cannot mint a staff
token. Staff permissions are resolved from the *current* database role on every
request, so a demoted account loses access immediately rather than when its token
expires. The socket transport asks the same question — a staff member disabled at
09:00 keeps a valid eight-hour token until 17:00, so `AUDIENCE.STAFF` checks the
row, not just the signature.

---

## Sockets

Four services attach a Socket.io server. A service owns the sockets that touch
the things it owns — see [docs/SOCKET-API.md](docs/SOCKET-API.md) for the full
protocol.

| Service | Events | Why there |
| --- | ---: | --- |
| user | 49 | auth, wallet, chat, profile, rakeback, spin, bonus, preferences, moderation |
| casino | 25 | a game round is a debit, a result and a payout in one transaction |
| admin | 3 | the operator console |
| sports | 1 | `C.SPORT_GAME` needs the feed client, its cache and its credentials |

A module declares an event with an **audience** and the transport attaches the
guard, exactly as the HTTP loader does — so a handler physically cannot forget
its own auth check.

The wire names are opaque hashes lifted byte-for-byte from
`legacy/General/Constant/index.js` (`C.SEND_TIP` is
`"573a867973fa586555cab080e7d837ad"`). They are the client protocol and cannot
be changed; a test pins the whole table against the legacy file.

---

## Background worker

`services/sports/src/worker.js` is a **separate process** from the sports HTTP
service, replacing the four standalone crons in `legacy/sportsmain/cron/`.

```bash
npm run start:sports-worker     # on its own
npm run dev                     # started alongside everything else
curl localhost:4104/health      # per-job run and failure counts
```

Separate because the odds job runs every 2 seconds — sharing an event loop with
request handling means every bet placement queues behind a feed poll — and
because scaling is opposite: HTTP scales out to N instances, crons must
effectively run once.

| Job | Interval | Exclusive | Does |
| --- | --- | --- | --- |
| `feed:events` | 60s | no | Fixture lists → cache |
| `feed:odds` | 2s | no | Live odds → cache (5s TTL) |
| `results:poll` | 60s | **yes** | Finished events → settlement queue |
| `results:settle` | 60s | **yes** | Settles matches, pays winners |
| `housekeeping` | 15m | **yes** | Clears orphaned exposure rows |

Feed jobs are read-only, so duplicate polling is wasteful but harmless.
Everything that writes is `exclusive` and takes a Postgres advisory lock. The
same pattern guards the Crash and Keno game loops in casino-service — legacy ran
one game per CPU worker, so which round a player saw depended on which process
their socket landed on.

`REDIS_URL` is required beyond local development. Without it the worker caches
into its own heap and the HTTP service reads its own empty one — the worker warns
loudly on boot rather than looking fine.

---

## Database

The supplied schema (`000_baseline_schema.sql`) is applied by migration
`000-baseline-schema`. Models were **generated from that DDL** rather than
hand-written, so column types, defaults and constraints match exactly:

```bash
npm run db:generate-models    # regenerate from the baseline
npm run db:verify             # assert every model matches the live schema
```

`db:verify` is the check worth running in CI — it catches a model naming a
column the database does not have, which Sequelize otherwise reveals only at
runtime.

Tables added after the baseline live in the `extended` domain as hand-written
models, so regeneration cannot remove them. Columns added to a baseline table go
in `packages/db/src/models/extensions.js` for the same reason.

Migrations run inside a transaction and are recorded in `sequelize_meta`.
Destructive `down()` steps are gated behind `ALLOW_DESTRUCTIVE_MIGRATION=true`.
Several deliberately have no `down()` — reversing them would restore a defect.

---

## Commands

```bash
npm run dev              # gateway + four services, with reload
npm run dev:mono         # everything in one process (debugging)
npm test                 # 1095 tests, against a real PostgreSQL

npm run db:migrate       # apply pending migrations
npm run db:status        # applied vs pending
npm run db:seed
npm run db:verify        # every model against the real schema

npm run verify:modules   # module map + gateway rewrites all resolve
npm run verify:routes    # legacy HTTP coverage
npm run verify:sockets   # legacy socket coverage
npm run verify:models    # models match the database
npm run verify:secrets   # no committed credential in the ported code

npm run exposures:rebuild            # dry run — prints what it would change
npm run exposures:rebuild -- --apply
```

`npm test` needs an `ibitplay_test` database. Tests skip with a message if one
is not reachable; they never mock the database away.

---

## Legacy compatibility

Existing clients do not have to change. The gateway rewrites old paths onto new
ones:

```js
'POST /api/gis/games/init': '/api/v1/casino/gis/launch',
```

`npm run verify:modules` fails if any rewrite points at a route that is not
mounted, so the table cannot drift from the services.

Some legacy paths are **deliberately not mapped**, and each says why at the
mapping site:

| Not mapped | Because |
| --- | --- |
| `GET /sportsbooks/launch?url=` | Fetched any URL server-side and returned the body |
| `POST /uploadImage` | Wrote bytes to a public directory with no row pointing at them |
| `DELETE /admin/p2p/order/:id` | Destroyed the record of a payout while the ledger row survived |
| `POST /pedramx` · `new_query` | Arbitrary SQL, unauthenticated |

A rewrite would imply the capability moved somewhere. It did not.

---

## Current state

```text
66 modules, 568 routes          npm run verify:modules
555 / 577 legacy HTTP (96.2%)   npm run verify:routes
77 / 79 legacy sockets (97.5%)  npm run verify:sockets
every model matches             npm run verify:models
no committed secret present     npm run verify:secrets
1095 tests, 0 failing           npm test
37 migrations, 0 pending        npm run db:status
```

The remaining gaps are decisions, documented where they are:

- **`C.PLAT_SLOTS`** — a transfer-wallet aggregator whose money model
  (`Evo.deposit` of the player's whole balance, with no local debit) needs the
  provider's documentation to port safely. `docs/SOCKETS.md` §9.
- **`new_query` and `/pedramx`** — arbitrary SQL authorised by a boolean in the
  caller's own message. Never porting; already disabled on the live box by
  `legacy-hotfix/`.
- **22 legacy HTTP routes** — the same class. `docs/ROUTE-PORT-CHECKLIST.md`
  lists each with its reason.


  adminer local 
  ./tools/adminer/start.sh          # port 8088
PORT=9000 ./tools/adminer/start.sh

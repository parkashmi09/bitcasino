# API — routes, structure and how to call them

Every HTTP surface the platform serves: how a request is routed, which guard it
meets, what comes back, and where each module lives.

|  |  |
| --- | ---: |
| Services | 4 + gateway |
| Modules | 66 |
| Routes mounted | 587 |
| Error codes declared | 56 catalogues |
| Legacy routes ported | 555 / 577 (96.2%) |

Both appendices are **generated**, and everything above them is hand-written:

| Command | Rewrites | From |
| --- | --- | --- |
| `node tools/api-surface.js` | Appendix A — every mounted route, its guard and its response shape | The service source: manifests, route files, controllers, error catalogues |
| `node tools/route-inventory.js` | Appendix B — the legacy port checklist | The `@legacy` tags in the source |

`node tools/api-surface.js --check` fails if Appendix A no longer matches the
code, and `--json` writes the same data to `docs/api-surface.json` for anything
that would rather read it than the table.

**Contents**

1. [Where to send a request](#1-where-to-send-a-request)
2. [The four audiences](#2-the-four-audiences)
3. [Authentication](#3-authentication)
4. [The response envelope](#4-the-response-envelope)
5. [Errors](#5-errors)
6. [Pagination, filtering and money](#6-pagination-filtering-and-money)
7. [Uploads](#7-uploads)
8. [The module map](#8-the-module-map)
9. [Service-to-service calls](#9-service-to-service-calls)
10. [Legacy compatibility](#10-legacy-compatibility)
11. [Appendix A — the live API surface](#appendix-a--the-live-api-surface)
12. [Appendix B — every legacy route](#appendix-b--every-legacy-route)

---

## 1. Where to send a request

**Everything goes to the gateway.** In development that is
`http://127.0.0.1:4000`. The four services listen on 4001–4004, but those ports
are an implementation detail — nothing outside the cluster should address them,
and `/internal/*` is refused at the gateway outright.

```text
https://api.example.com
  /health                     aggregated platform health
  /api/v1                     endpoint index
  /api/v1/<service>/...       public and player routes
  /api/v1/admin/<service>/... staff routes
```

The service segment is part of the path, so routing is a prefix match with no
lookup table:

| Prefix | Reaches |
| --- | --- |
| `/api/v1/user/...` | user-service :4001 |
| `/api/v1/casino/...` | casino-service :4003 |
| `/api/v1/sports/...` | sports-service :4004 |
| `/api/v1/admin/...` | admin-service :4002, **or** another service's admin routes |
| `/internal/...` | **refused at the gateway** — cluster-internal only |

`/api/v1/admin/user/vault` is user-service's admin router, not admin-service. The
`admin` segment names the *audience*; the segment after it names the service that
owns the data. admin-service's own modules skip the repetition —
`/api/v1/admin/players`, not `/api/v1/admin/admin/players`.

### A worked example

```bash
# Public — no token
curl localhost:4000/api/v1/casino/games

# Player — bearer token
curl localhost:4000/api/v1/user/wallet \
     -H 'Authorization: Bearer <player access token>'

# Staff — staff token, and the route also checks a permission
curl localhost:4000/api/v1/admin/user/vault/users \
     -H 'Authorization: Bearer <staff token>'

# Internal — never reachable from outside
curl localhost:4001/internal/user/wallet/debit \
     -H 'x-internal-key: <INTERNAL_API_KEY>' \
     -H 'x-internal-service: casino-service' \
     -d '{...}'
```

---

## 2. The four audiences

A module declares its routers by audience, and **the loader attaches the guard**
— a route handler never performs its own auth check:

| Audience | Mounts at | Guard | Sets |
| --- | --- | --- | --- |
| `public` | `/api/v1/<service><basePath>` | none | — |
| `user` | `/api/v1/<service><basePath>` | player token | `req.user` |
| `admin` | `/api/v1/admin/<service><basePath>` | staff token + permission | `req.staff` |
| `internal` | `/internal/<service><basePath>` | internal key | `req.internalService` |

**`public` is an audience, not a path segment.** A public router and a user
router mount at the *same* path — one carries a guard, the other does not. So
`GET /api/v1/user/crypto/networks` (public) and
`GET /api/v1/user/crypto/addresses` (player) sit side by side.

A module that declares `user`, `admin` or `internal` routes and is mounted
without the matching guard **fails at boot** rather than serving an
unauthenticated surface. That is the property the loader exists for.

### Why this matters

In the source this replaces, the guard was a line you remembered to type:

```js
router.post('/createBlog', upload.single('image'), async (req, res) => {
```

No middleware. The same shape produced `POST /reports/export` returning every
player's name, referral code and balance to anyone who asked, and 21 P2P routes
— thirteen of them under `/admin/p2p/` — with none at all. Here the audience is
a property of the file the router lives in, and the guard comes with it.

---

## 3. Authentication

### Players

```http
Authorization: Bearer <access token>
```

`POST /api/v1/user/auth/login` returns an access token and a refresh token.
Access tokens are short-lived; rotate with `POST /api/v1/user/auth/refresh`.

Two token families with two secrets: a leaked player secret cannot mint a staff
token. `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `JWT_ADMIN_SECRET` are
separate values and the `TokenService` refuses to construct without them.

### Staff

```http
Authorization: Bearer <staff token>
```

`POST /api/v1/admin/auth/login`. Permissions are resolved from the **current**
database role on every request, so a demoted account loses access immediately
rather than when its token expires. Routes declare what they need:

```js
router.post('/', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), ...);
```

### Internal

```http
x-internal-key: <INTERNAL_API_KEY>
x-internal-service: casino-service
```

Never proxied by the gateway. A request arriving at `/internal/*` from outside
the cluster is refused before it reaches a service.

### What the gateway strips

Any inbound `x-user-id`, `x-staff-id` or `x-internal-*` header is removed at the
edge before proxying. Legacy read `x-staff-id` straight off the request on the
deposit-report routes — a header anyone can set, naming the operator whose data
you get back.

---

## 4. The response envelope

One shape, everywhere:

```jsonc
// success — `meta` is present only when the handler passes one
{ "success": true, "data": { }, "meta": { } }

// failure — `details.requestId` is ALWAYS there; it is what to quote in a bug report
{ "success": false, "error": { "code": "WALLET_INSUFFICIENT_FUNDS",
                               "message": "Not enough balance",
                               "details": { "requestId": "c1f0…" } } }
```

`data` is whatever the handler passed — an object, an array, a string, or
`null`. It is never absent on a success, so `body.data` is always safe to read.

| Helper | Status | Body | Used for |
| --- | ---: | --- | --- |
| `response.ok(res, data, meta?)` | 200 | `{success, data, meta?}` | Reads and updates |
| `response.created(res, data, meta?)` | 201 | `{success, data, meta?}` | Something new exists |
| `response.accepted(res, data, meta?)` | 202 | `{success, data, meta?}` | Queued, not finished |
| `response.noContent(res)` | 204 | **empty** — no body at all | Deletes that return nothing |
| `response.paginated(res, rows, pagination, extraMeta?)` | 200 | `{success, data: [], meta.pagination}` | Lists — see §6 |
| `response.fail(res, status, code, message, details?)` | given | `{success: false, error}` | Answering a failure without throwing |

**204 carries no body.** Do not parse one — `res.status(204).end()` sends zero
bytes, and `JSON.parse('')` throws. Branch on the status first.

**The success status is meaningful, and one route uses it.**
`POST /api/v1/admin/user/bonus/games` answers `201` when the row was created and
`200` when it was already there — a second call is not a second row, which is
what the unique key is for. Anywhere the Appendix A tables list two entries for
one route, the handler chooses between them on a condition like that.

### The routes that answer outside it

Fifty-five do, in three families, and every one of them says why at the handler.
They are marked **raw** in the Appendix A tables, so the list below is the shape
of the exception rather than something to keep in sync by hand.

| Family | Count | What comes back | Why |
| --- | ---: | --- | --- |
| Binary and documents | 18 | The bytes, with a detected `Content-Type` | They are `<img>` targets, PDF downloads and one CSV export. An envelope around a JPEG helps nobody. |
| Provider callbacks | 19 | The provider's own envelope, HTTP 200 even for a refusal | Aggregator clients retry on anything they cannot parse. A 4xx carrying our error envelope is an infinite retry loop against a money endpoint. |
| Legacy-shaped JSON | 18 | `{success, data}`, `{history, count}`, `{success, message, …}` | An existing client parses that exact object. Fields were added, none renamed. |

The provider family covers `x-casino`, `seamless`, `gis/callback/transactions`,
`js-games` v1 and v2, the three `aggregators` callbacks, the CCPayment callback
and both PSP callbacks. The legacy-shaped family is `sports/settlement` (11),
`POST /api/v1/sports/bets`, and wallet `history` on both the player and staff
side.

`POST /api/v1/sports/bets` is the sharpest of them: it hand-rolls its own
envelope **and** its own error handling — `200 {success, exposure,
balanceDelta, oldBalance, newBalance, totalExposure}`, `400 {success: false,
message}` for anything that threw — because the betting board on the other end
parses that and nothing else. It is the one route in the platform where a
failure does not reach the shared error handler.

---

## 5. Errors

Every error is declared with a namespace, a stable code and a status:

```js
module.exports = defineErrors('WALLET', {
  INSUFFICIENT_FUNDS: { status: 402, message: 'Not enough balance' },
});
// → code "WALLET_INSUFFICIENT_FUNDS"
```

Duplicates are detected at boot. Clients should branch on `error.code`, never on
`error.message` — the message is for a human and may be reworded.

**Every module's catalogue is listed in [Appendix A](#appendix-a--the-live-api-surface)**
— 56 namespaces, with the status and message beside each code. Errors are thrown
from the service layer, so any code in a module's catalogue is reachable from any
route in that module.

| Status | Means |
| --- | --- |
| 400 | The request is malformed, or changed nothing |
| 401 | No token, or it did not verify |
| 402 | Not enough balance |
| 403 | Authenticated, but not allowed — or the account is locked |
| 404 | No such thing **or not yours** — deliberately the same answer |
| 409 | State conflict: already settled, already claimed, already open |
| 413 / 415 | Upload too large / not an accepted image |
| 422 | Well-formed but unacceptable: unknown currency, below a minimum |
| 429 | Rate limited |
| 502 / 503 | A provider failed, or an integration is not configured |

**404 covers "not yours".** A P2P order that belongs to somebody else answers
exactly as one that does not exist. Distinguishing them turns the endpoint into
an oracle for which ids are real.

### The codes every route can return

These come from the shared middleware rather than any module catalogue, so no
route declares them and every route can produce them:

| Status | Code | When | Extra `details` |
| ---: | --- | --- | --- |
| 400 | `BAD_REQUEST` | A handler rejected the input itself | — |
| 400 | `MALFORMED_JSON` | The body is not valid JSON | — |
| 401 | `UNAUTHORIZED` | No token, expired, wrong secret; or a bad internal key | — |
| 403 | `FORBIDDEN` | Missing permission, locked account, or acting on an account at or above your own level | — |
| 403 | `INVALID_CSRF_TOKEN` | CSRF check failed | — |
| 404 | `NOT_FOUND` | No route matched — and the terminal handler names the method and path | — |
| 409 | `CONFLICT` | Unique constraint | `fields[]` |
| 409 | `FOREIGN_KEY_VIOLATION` | Referenced row does not exist | — |
| 413 | `PAYLOAD_TOO_LARGE` | Body over the limit | — |
| 422 | `VALIDATION_ERROR` | A zod schema rejected the request | `fields[]` |
| 429 | `TOO_MANY_REQUESTS` | Rate limited — a `Retry-After` header comes with it | `retryAfter`, `bucket` |
| 500 | `INTERNAL_ERROR` | Anything unhandled. The real error is logged, never sent | `stack[]` in dev only |
| 500 | `DATABASE_ERROR` | A database error — the SQL is deliberately not surfaced | — |
| 503 | `DATABASE_UNAVAILABLE` | Cannot reach the database | — |
| 504 | `DATABASE_TIMEOUT` | Query timed out | — |

A validation failure carries the offending fields, so a form can mark them
without parsing prose:

```jsonc
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Validation failed",
             "details": { "requestId": "c1f0…",
                          "fields": [ { "field": "amount",   "message": "amount must be greater than zero", "code": "too_small" },
                                      { "field": "query.limit", "message": "Number must be less than or equal to 100", "code": "too_big" } ] } } }
```

The `field` is dotted and names the request part it came from — `query.limit`,
`params.id` — except for the body, whose prefix is stripped because that is where
a form's field names already live.

**An unknown key is usually a 422, not a silent strip.** Most schemas here are
`.strict()` — 48 of the 55 validator files (user 22/25, admin 14/15, casino 9/9,
sports 3/6) — and a strict schema *rejects* a key it does not declare:

```jsonc
// GET /api/v1/casino/games/providers?limit=5
{ "code": "VALIDATION_ERROR",
  "details": { "fields": [ { "field": "query",
                            "message": "Unrecognized key(s) in object: 'limit'",
                            "code": "unrecognized_keys" } ] } }
```

The seven non-strict schemas do drop the key silently, which is the more
dangerous half: `GET /api/v1/sports/bets?page=2&limit=5` answers **200 with page
one**, because that route pages on `limit`/`offset` and `page` is simply
discarded. So a wrong key is either a loud 422 or a quiet wrong answer depending
on the route, and a client cannot tell which without reading the validator.

**Send only the keys a route declares.** The parsed result does replace
`req.body`, `req.query` and `req.params`, so nothing can be smuggled past a
schema — but that is a property of what survives parsing, not a licence to send
extra fields.

---

## 6. Pagination, filtering and money

**Three request conventions, one response shape.**

| Convention | Keys | Used by |
| --- | --- | --- |
| offset-based | `limit`, `offset` | most lists — wallet ledger, vault, transaction history, sports bets |
| page-based | `page`, `limit` | blogs, gis, games, x-gaming, statements, bet-history, deposit-reports, p2p |
| **per-page** | `page`, **`per_page`** | **js-games v1 and v2** |

The third is easy to miss and there is no way to guess it:
`GET /api/v1/casino/js-games/v1/games?page=1&limit=5` answers **422**, because
`limit` is not a key that route takes.

Which convention a route wants is in its validator, and sending the wrong pair
is **not** harmless — see §5. Against a strict schema it is a 422; against a
non-strict one the key is dropped and you get page one while believing you asked
for page two. The Appendix A tables mark every paginated route.

```http
GET /api/v1/user/p2p/orders?page=2&limit=25          # page-based: blogs, gis, games,
                                                     # js-games, statements, x-gaming,
                                                     # bet-history, deposit-reports, p2p
GET /api/v1/user/wallet/ledger?limit=25&offset=25    # offset-based: everything else
```

The answer is the same either way — `data` is the rows, and everything about the
page is under **`meta.pagination`**:

```jsonc
{ "success": true,
  "data": [ /* rows */ ],
  "meta": { "pagination": { "page": 2, "limit": 25, "total": 137,
                            "totalPages": 6, "hasNext": true, "hasPrev": true } } }
```

`page` is reported even on an offset-based route — it is derived as
`floor(offset / limit) + 1`. There is no `meta.total` at the top level; read
`meta.pagination.total`.

A route may add its own keys beside `pagination` (a `summary`, a set of totals);
nothing is ever removed.

Every list is capped — commonly at 100 or 200 rows, per validator. Legacy's
`GET /all` selected every blog row including every full article body, unpaged, on
an unauthenticated route.

**Money is always a string**, in and out — `"12.50000000"`, never `12.5`.
Balances are `NUMERIC(30,8)`; a JSON number cannot carry that precision, and
`0.1 + 0.2` in a float is not `0.3`. Amounts are validated as decimals with up
to eight places and converted to `BigInt` minor units internally.

Date ranges use `from` and `to` as ISO-8601.

---

## 7. Uploads

`multipart/form-data`, one file per request, through
`@ibitplay/common/imageUpload`:

| | |
| --- | --- |
| Accepted | PNG, JPEG, WebP — **by magic bytes**, never by filename or declared MIME |
| Refused | SVG, explicitly — it can carry `<script>` and would run on the platform origin |
| Max | 4 MB |
| Stored | In the row (`BYTEA`), not on disk |
| Served | `GET .../:id/image` with the **detected** content type and `X-Content-Type-Options: nosniff` |

Three modules take images — `banners`, `blogs` and `p2p` — and all three had the
same defect: the format was judged from `file.mimetype` or
`path.extname(file.originalname)`, both chosen by the uploader. Declaring
`image/png` while naming the file `x.html` put an HTML document in a
statically-served directory on the platform's own origin.

The bytes live in the row because local disk is not shared between replicas: an
upload landing on one server was a 404 from the next, intermittently, and the
whole directory was lost on restart. For a payment proof — the evidence in a
dispute over real money — that is the difference between having a record and not.

---

## 8. The module map

Every module, its base path and which audiences it exposes. Combine the base
path with the audience prefix from §2 to get the URL.

For example `vault` exposes `player` and `staff`, so it serves
`/api/v1/user/vault/*` and `/api/v1/admin/user/vault/*`.

For the routes themselves — every path, its guard and what it answers with — go
to [Appendix A](#appendix-a--the-live-api-surface); this table is the index over
it.

### user-service — :4001

| Module | Base path | Audiences | Sockets |
| --- | --- | --- | :-: |
| `affiliate` | `/affiliate` | player, staff |  |
| `auth` | `/auth` | public, player | ● |
| `bank-details` | `/bank-details` | player, staff |  |
| `bonus` | `/bonus` | player, staff | ● |
| `club` | `/clubs` | player, staff |  |
| `club-broadcasts` | `/club-broadcasts` | player |  |
| `crypto` | `/crypto` | public, player, staff |  |
| `crypto-withdraw` | `/withdrawals/crypto` | player, staff | ● |
| `deposit-reports` | `/history` | staff |  |
| `directory` | `/directory` | staff |  |
| `email` | `/email` | public, staff |  |
| `exchange-rate` | `/exchange-rate` | public, staff, internal |  |
| `fiat-deposit` | `/deposits/fiat` | player, staff |  |
| `fiat-withdraw` | `/withdrawals/fiat` | player, staff |  |
| `gift-cards` | `/gift-cards` | player, staff |  |
| `kyc` | `/kyc` | player, staff |  |
| `p2p` | `/p2p` | player, staff |  |
| `payment-orders` | `/payments` | player, staff |  |
| `preferences` | `/preferences` | player | ● |
| `profile` | `/profile` | public, player | ● |
| `psp` | `/psp` | public, player, staff |  |
| `rakeback` | `/rakeback` | player | ● |
| `social` | `/social` | — | ● |
| `spin-wheel` | `/spin-wheel` | public, player, staff | ● |
| `swap` | `/swap` | player, staff |  |
| `transaction-history` | `/history` | player, staff |  |
| `twofa` | `/2fa` | player |  |
| `vault` | `/vault` | player, staff |  |
| `wager` | `/wager` | player, staff |  |
| `wallet` | `/wallet` | player, staff, internal | ● |

### admin-service — :4002

| Module | Base path | Audiences | Sockets |
| --- | --- | --- | :-: |
| `access` | `/access` | staff |  |
| `audit` | `/audit` | staff, internal |  |
| `banners` | `/banners` | public, staff |  |
| `blogs` | `/blogs` | public, staff |  |
| `dashboard` | `/dashboard` | staff |  |
| `locks` | `/locks` | public, staff |  |
| `lords` | `/accounts` | staff | ● |
| `marketing` | `/marketing` | staff |  |
| `notifications` | `/notifications` | staff, internal |  |
| `players` | `/players` | staff |  |
| `reports` | `/reports` | staff |  |
| `site-config` | `/site-config` | staff, internal |  |
| `staff` | `/staff` | staff |  |
| `staff-auth` | `/auth` | public, staff, internal |  |
| `staff-directory` | `/staff-directory` | internal |  |
| `statements` | `/statements` | staff |  |

### casino-service — :4003

| Module | Base path | Audiences | Sockets |
| --- | --- | --- | :-: |
| `aggregators` | `/aggregators` | public |  |
| `bet-history` | `/bet-history` | public, player, staff, internal |  |
| `catalogue` | `/catalogue` | public, player, staff |  |
| `games` | `/games` | public, player, staff |  |
| `gis` | `/gis` | public, player, staff |  |
| `house` | `/house` | staff |  |
| `in-house` | `/in-house` | — | ● |
| `js-games` | `/js-games` | public, player, staff |  |
| `seamless` | `/seamless` | public, player |  |
| `sportsbook` | `/sportsbook` | public, player |  |
| `wager-report` | `/wager` | internal |  |
| `x-casino` | `/x-casino` | public, player |  |
| `x-gaming` | `/x-gaming` | public |  |

### sports-service — :4004

| Module | Base path | Audiences | Sockets |
| --- | --- | --- | :-: |
| `bet-admin` | `/bet-admin` | staff, internal |  |
| `bets` | `/bets` | player |  |
| `catalogue` | `/catalogue` | public, staff |  |
| `feed` | `/feed` | public | ● |
| `results` | `/results` | player, staff |  |
| `settlement` | `/settlement` | player, staff, internal |  |
| `wager-report` | `/wager` | internal |  |

---

## 9. Service-to-service calls

A service that needs something outside its own model domains asks over
`/internal/...` with the internal key. It never reaches into another service's
tables.

| Caller | Endpoint | For |
| --- | --- | --- |
| casino, sports | `POST /internal/user/wallet/debit` · `/credit` | **Every** balance change |
| casino, sports | `GET /internal/user/wallet/balance` | A player's balance |
| user | `GET /internal/admin/auth/verify` | Is this staff id still active? |
| user | `POST /internal/admin/notifications/*` | A player's own notifications |
| admin | `GET /internal/sports/bet-admin/net` | Net sports exposure |
| admin | `GET /internal/casino/wager/turnover/:id` · `/internal/sports/...` | Turnover for a statement |
| sports | `GET /internal/user/exchange-rate` | Converting a stake |

**All money moves through user-service.** Casino and sports never write
`credits`, so the row locking, ledger writes and idempotency rules exist in
exactly one place rather than three that drift.

Every movement carries an idempotency key derived from the thing being paid for
— `p2p-buy-release:P2PA1B2C3`, `vault-out:1471` — so a retry after a timeout
returns the original ledger row instead of paying twice.

---

## 10. Legacy compatibility

Existing clients do not have to change. The gateway rewrites the old path onto
the new one:

```js
// gateway/src/legacyRoutes.js
'POST /api/gis/games/init': '/api/v1/casino/gis/launch',
'GET  /sportsbooks':        '/api/v1/casino/sportsbook',
'POST /createBlog':         '/api/v1/admin/blogs',
```

`npm run verify:modules` fails if any rewrite points at a route that is not
mounted, so the table cannot drift away from the services.

### What changed for a client

Three things, and each has a reason at the mapping site:

1. **Some routes now need a token.** `POST /api/gis/games/init` took `player_id`
   from the request body on an unauthenticated route — one POST opened a
   real-money session on any account. The id comes from the token now, so a
   client calling it must send one.

2. **Two syncs became POSTs.** They were GETs that wrote hundreds of rows, so a
   browser prefetch could trigger a catalogue rebuild.

3. **A path parameter replaced a query string or body field** wherever the old
   route carried its key that way. `POST /updateBlog?id=5` is
   `PATCH /api/v1/admin/blogs/5`. The exact-match table cannot express these, so
   they are listed as comments beside the block they belong to.

### Deliberately not mapped

| Legacy | Why there is no replacement |
| --- | --- |
| `POST /pedramx` · `new_query` | Arbitrary SQL. The socket version was authorised by a boolean in the caller's own message. Already disabled on the live box by `legacy-hotfix/`. |
| `GET /sportsbooks/launch?url=` | Fetched any URL server-side and returned the body — cloud metadata, anything on localhost — forwarding the caller's IP. `init` returns the launch URL; the browser opens it. |
| `POST /uploadImage` | Wrote bytes to a publicly-served directory with no row pointing at them, so an orphan could never be found or cleaned up. An image is a field on a post now. |
| `DELETE /admin/p2p/order/:id` | A bare DELETE with no status check. Removing a RELEASED order destroys the only record that crypto was paid out, while the ledger row survives with nothing to reconcile against. |

A rewrite would imply the capability moved somewhere. It did not.

---

## Appendix A — the live API surface

<!-- BEGIN GENERATED: node tools/api-surface.js -->

Every route the four services mount today, with the guard the loader
attaches and the shape the handler answers with. Regenerate with
`node tools/api-surface.js`.

| | |
| --- | ---: |
| Routes mounted | 588 |
| Modules | 66 |
| Answering outside the envelope | 55 |

**Guard** is the audience the loader mounted the router under, plus anything
the route adds. `public` carries no token. `player` and `staff` carry one.
A grant string — `wallet:credit` — is checked against the caller's CURRENT
database role on every request. `self-only` marks the loader's documented
exemption: a staff write that takes no account id because it acts on the
caller's own session, where a grant would protect nothing.

**Response** reads as `status` `shape`. A shape in braces is an object literal
in the source with those top-level keys; a bare name is the expression the
handler passes, and its shape is whatever that function returns. `[…]` with
`meta.pagination` is the list envelope from §6. **raw** means the route answers
outside the platform envelope — §4 says which families do and why.

More than one entry means the route answers differently depending on a
condition in the handler, listed in source order — the first is the main path.
A binary route shows its `Content-Type` and then the send. Failures are not
listed per route: they are thrown from the service layer, so a module's whole
error catalogue is reachable from every route in it, and the catalogues are at
the end of this appendix.

### admin-service — :4002 (129 routes)

#### `access`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/access/activity` | `staff` + `audit:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/access/executives` | `staff` + `staff:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/access/executives` | `staff` + `roles:manage` | `201` `service.createExecutive(…)` |
| `PATCH` | `/api/v1/admin/access/executives/:executiveId` | `staff` + `roles:manage` | `200` `service.updateExecutive(…)` |
| `GET` | `/api/v1/admin/access/executives/:executiveId/activity` | `staff` + `audit:read` | `200` `[…]` + `meta.pagination` |
| `PATCH` | `/api/v1/admin/access/executives/:executiveId/password` | `staff` + `roles:manage` | `200` `service.resetPassword(…)` |
| `PATCH` | `/api/v1/admin/access/executives/:executiveId/status` | `staff` + `roles:manage` | `200` `service.setStatus(…)` |
| `GET` | `/api/v1/admin/access/marketing-users` | `staff` + `staff:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/access/marketing-users` | `staff` + `roles:manage` | `201` `service.createExecutive(…)` |
| `PATCH` | `/api/v1/admin/access/marketing-users/:executiveId/password` | `staff` + `roles:manage` | `200` `service.resetPassword(…)` |
| `PATCH` | `/api/v1/admin/access/marketing-users/:executiveId/status` | `staff` + `roles:manage` | `200` `service.setStatus(…)` |
| `GET` | `/api/v1/admin/access/me/permissions` | `staff` | `200` `service.myPermissions(…)` |

#### `audit`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/audit/activity` | `staff` + `audit:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/internal/admin/audit/activity` | `internal` | `202` `{ id }` |

#### `banners`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/banners` | `public` | `200` `result.rows` |
| `GET` | `/api/v1/admin/banners/:type` | `public` | `200` `service.byType(…)` |
| `GET` | `/api/v1/admin/banners/binary` | `public` | `200` `result.rows` |
| `GET` | `/api/v1/admin/banners/image/:filename` | `public` | **raw** `Content-Type: image.contentType` · **raw** `res.end(…)` |
| `POST` | `/api/v1/admin/banners` | `staff` + `config:write` | `200` `service.putBanner(…)` |
| `PATCH` | `/api/v1/admin/banners/:type/active` | `staff` + `config:write` | `200` `service.setActive(…)` |

#### `blogs`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/blogs` | `public` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/blogs/:id` | `public` | `200` `service.byId(…)` |
| `GET` | `/api/v1/admin/blogs/:id/image` | `public` | **raw** `Content-Type: image.contentType` · **raw** `res.send(…)` |
| `GET` | `/api/v1/admin/blogs/category/:category` | `public` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/blogs/slug/:slug` | `public` | `200` `service.bySlug(…)` |
| `POST` | `/api/v1/admin/blogs` | `staff` + `config:write` | `201` `service.create(…)` |
| `DELETE` | `/api/v1/admin/blogs/:id` | `staff` + `config:write` | `200` `service.remove(…)` |
| `PATCH` | `/api/v1/admin/blogs/:id` | `staff` + `config:write` | `200` `service.update(…)` |
| `DELETE` | `/api/v1/admin/blogs/slug/:slug` | `staff` + `config:write` | `200` `service.remove(…)` |

#### `dashboard`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/dashboard` | `staff` + `reports:read` | `200` `service.overview(…)` |
| `GET` | `/api/v1/admin/dashboard/members/:userId` | `staff` + `reports:read` | `200` `service.memberTeam(…)` |
| `GET` | `/api/v1/admin/dashboard/movements` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/dashboard/registrations` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/dashboard/today` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/dashboard/totals` | `staff` + `reports:read` | `200` `service.lifetimeTotals(…)` |
| `GET` | `/api/v1/admin/dashboard/user-stats` | `staff` + `reports:read` | `200` `service.userStats(…)` |

#### `locks`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/locks/ref/:slug` | `public` + rate-limited | `200` `service.resolveReferral(…)` |
| `POST` | `/api/v1/admin/locks` | `staff` + `users:write` | `200` `service.updateLocks(…)` |
| `GET` | `/api/v1/admin/locks/transfers/:userId` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |

#### `lords`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/accounts` | `staff` + `users:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/accounts/credit-limit` | `staff` + `wallet:adjust` | `200` `service.setCreditLimit(…)` |
| `POST` | `/api/v1/admin/accounts/exposure-limit` | `staff` + `users:write` | `200` `service.setExposureLimit(…)` |
| `GET` | `/api/v1/admin/accounts/exposure/sports` | `staff` + `users:read` | `200` `service.netExposure(…)` |
| `POST` | `/api/v1/admin/accounts/password` | `staff` + `users:write` | `200` `service.setPassword(…)` |
| `POST` | `/api/v1/admin/accounts/refill` | `staff` + `wallet:adjust` | `201` `service.refill(…)` |
| `GET` | `/api/v1/admin/accounts/statement` | `staff` + `users:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/accounts/status` | `staff` + `users:lock` | `200` `service.setStatus(…)` |

#### `marketing`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/marketing/analytics/deposits` | `staff` | `200` `service.deposits(…)` |
| `GET` | `/api/v1/admin/marketing/analytics/retention` | `staff` | `200` `service.retention(…)` |
| `GET` | `/api/v1/admin/marketing/analytics/signups` | `staff` | `200` `service.signups(…)` |
| `GET` | `/api/v1/admin/marketing/analytics/top-agents` | `staff` | `200` `service.topAgents(…)` |
| `GET` | `/api/v1/admin/marketing/customers` | `staff` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/marketing/me` | `staff` | `200` `service.me(…)` |

#### `notifications`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/admin/notifications/broadcast` | `staff` + `config:write` | `202` `service.broadcast(…)` |
| `GET` | `/api/v1/admin/notifications/devices` | `staff` + `users:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/notifications/history/:userId` | `staff` + `users:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/notifications/send` | `staff` + `config:write` | `202` `service.sendToUser(…)` |
| `GET` | `/api/v1/admin/notifications/unread/:userId` | `staff` + `users:read` | `200` `service.unreadCount(…)` |
| `POST` | `/internal/admin/notifications/devices` | `internal` | `201` `service.registerDevice(…)` |
| `GET` | `/internal/admin/notifications/history` | `internal` | `200` `[…]` + `meta.pagination` |
| `POST` | `/internal/admin/notifications/read` | `internal` | `200` `service.markRead(…)` |
| `GET` | `/internal/admin/notifications/unread` | `internal` | `200` `service.unreadCount(…)` |

#### `players`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/admin/players` | `staff` + `users:write` | `201` `service.create(…)` |
| `DELETE` | `/api/v1/admin/players/:playerId` | `staff` + `users:write` | `200` `service.close(…)` |
| `PATCH` | `/api/v1/admin/players/:playerId` | `staff` + `users:write` | `200` `service.update(…)` |

#### `reports`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/reports/agent-users` | `staff` + `reports:read` | `200` `service.agentUsers(…)` |
| `GET` | `/api/v1/admin/reports/balance-sheet/:userId` | `staff` + `reports:read` | `200` `service.balanceSheet(…)` |
| `GET` | `/api/v1/admin/reports/player-sheet/:uid` | `staff` + `reports:read` | **raw** `Content-Type: application/pdf` · **raw** `streamed to res` |
| `GET` | `/api/v1/admin/reports/players` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/reports/players/:userId` | `staff` + `reports:read` | `200` `service.playerReport(…)` |
| `GET` | `/api/v1/admin/reports/players/export` | `staff` + `reports:read` | **raw** `Content-Type: text/csv; charset=utf-8` · **raw** `res.send(…)` |
| `GET` | `/api/v1/admin/reports/staff-risk/:staffId` | `staff` + `reports:read` | `200` `service.staffRisk(…)` |
| `GET` | `/api/v1/admin/reports/user-risk/:userId` | `staff` + `reports:read` | `200` `service.userRisk(…)` |

#### `site-config`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/site-config/public` | `public` + rate-limited | `200` `service.publicSettings(…)` |
| `GET` | `/api/v1/admin/site-config/affiliate` | `staff` + `config:read` | `200` `service.affiliateSettings(…)` |
| `PUT` | `/api/v1/admin/site-config/affiliate` | `staff` + `config:write` | `200` `service.updateAffiliateSettings(…)` |
| `GET` | `/api/v1/admin/site-config/email` | `staff` + `config:read` | `200` `service.emailSettings(…)` |
| `PUT` | `/api/v1/admin/site-config/email` | `staff` + `config:write` | `200` `service.updateEmailSettings(…)` |
| `POST` | `/api/v1/admin/site-config/email/test` | `staff` + `config:write` | `200` `service.sendTestEmail(…)` |
| `GET` | `/api/v1/admin/site-config/global` | `staff` + `config:read` | `200` `service.globalSettings(…)` |
| `PUT` | `/api/v1/admin/site-config/global` | `staff` + `config:write` | `200` `service.updateGlobalSettings(…)` |
| `GET` | `/api/v1/admin/site-config/sports` | `staff` + `config:read` | `200` `service.sportsEnabled(…)` |
| `PUT` | `/api/v1/admin/site-config/sports` | `staff` + `config:write` | `200` `service.setSportsEnabled(…)` |
| `GET` | `/api/v1/admin/site-config/user/:userId` | `staff` + `config:read` | `200` `service.userSettings(…)` |
| `PUT` | `/api/v1/admin/site-config/user/:userId` | `staff` + `config:write` | `200` `service.updateUserSettings(…)` |
| `GET` | `/internal/admin/site-config/affiliate` | `internal` | `200` `service.affiliateSettings(…)` |
| `GET` | `/internal/admin/site-config/sports` | `internal` | `200` `service.sportsEnabled(…)` |

#### `staff`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/staff` | `staff` + `staff:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/staff` | `staff` + `staff:write` | `201` `service.create(…)` |
| `DELETE` | `/api/v1/admin/staff/:staffId` | `staff` + `staff:write` | `200` `service.remove(…)` |
| `GET` | `/api/v1/admin/staff/:staffId` | `staff` + `staff:read` | `200` `service.getById(…)` |
| `PATCH` | `/api/v1/admin/staff/:staffId` | `staff` + `staff:write` | `200` `service.update(…)` |
| `GET` | `/api/v1/admin/staff/:staffId/percent-chain` | `staff` + `staff:read` | `200` `service.percentChain(…)` |
| `GET` | `/api/v1/admin/staff/:staffId/percent-tree` | `staff` + `staff:read` | `200` `service.percentTree(…)` |
| `GET` | `/api/v1/admin/staff/:staffId/whatsapp-ref` | `staff` + `staff:read` | `200` `service.whatsappRef(…)` |
| `GET` | `/api/v1/admin/staff/analytics/:staffId` | `staff` + `staff:read` | `200` `service.analytics(…)` |
| `POST` | `/api/v1/admin/staff/bulk-status` | `staff` + `staff:write` | `200` `service.bulkStatus(…)` |
| `PATCH` | `/api/v1/admin/staff/password` | `staff` + `staff:read` | `200` `service.changePassword(…)` |
| `GET` | `/api/v1/admin/staff/players` | `staff` + `staff:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/staff/rollup/:staffId` | `staff` + `staff:read` | `200` `service.rollup(…)` |
| `GET` | `/api/v1/admin/staff/transactions` | `staff` + `staff:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/staff/transfer` | `staff` + `wallet:adjust` | `201` `service.transfer(…)` |
| `GET` | `/api/v1/admin/staff/transfers` | `staff` + `staff:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/staff/transfers/:staffId` | `staff` + `staff:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/staff/transfers/summary` | `staff` + `staff:read` | `200` `service.transferSummary(…)` |
| `GET` | `/api/v1/admin/staff/tree` | `staff` + `staff:read` | `200` `service.tree(…)` |

#### `staff-auth`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/admin/auth/executive/login` | `public` + rate-limited | `200` `service.executiveLogin(…)` |
| `POST` | `/api/v1/admin/auth/first-login-password` | `public` + rate-limited | `200` `service.firstLoginPassword(…)` |
| `POST` | `/api/v1/admin/auth/login` | `public` + rate-limited | `200` `service.login(…)` |
| `GET` | `/api/v1/admin/auth/2fa` | `staff` + self-only | `200` `service.twoFactorStatus(…)` |
| `POST` | `/api/v1/admin/auth/2fa/begin` | `staff` + self-only | `200` `service.beginTwoFactor(…)` |
| `POST` | `/api/v1/admin/auth/2fa/confirm` | `staff` + self-only + rate-limited | `200` `service.confirmTwoFactor(…)` |
| `POST` | `/api/v1/admin/auth/2fa/disable` | `staff` + self-only + rate-limited | `200` `service.disableTwoFactor(…)` |
| `POST` | `/api/v1/admin/auth/logout` | `staff` + self-only | `200` `service.logout(…)` |
| `GET` | `/internal/admin/auth/verify` | `internal` | `200` `{ active, staff }` |

#### `staff-directory`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/internal/admin/staff-directory/staff/:staffId` | `internal` | `200` `resolveStaff(…)` |
| `GET` | `/internal/admin/staff-directory/staff/:staffId/betlock` | `internal` | `200` `response.ok(…)` |
| `POST` | `/internal/admin/staff-directory/staff/:staffId/betlock` | `internal` | `200` `setBetLock(…)` |
| `GET` | `/internal/admin/staff-directory/staff/:staffId/betlock/list` | `internal` | `200` `response.ok(…)` |
| `GET` | `/internal/admin/staff-directory/staff/:staffId/descendants` | `internal` | `200` `{ staffId, ids }` |
| `GET` | `/internal/admin/staff-directory/transfers/user/:userId` | `internal` | `200` `response.ok(…)` |
| `POST` | `/internal/admin/staff-directory/verify-transaction-password` | `internal` | `200` `{ staffId, verified }` |

#### `statements`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/statements/:staffId` | `staff` + `reports:read` | **raw** `Content-Type: application/pdf` · **raw** `streamed to res` |
| `GET` | `/api/v1/admin/statements/:staffId/bets` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/statements/:staffId/pdf` | `staff` + `reports:read` | **raw** `Content-Type: application/pdf` · **raw** `streamed to res` |
| `GET` | `/api/v1/admin/statements/:staffId/statement` | `staff` + `reports:read` | `200` `service.agentStatement(…)` |
| `GET` | `/api/v1/admin/statements/user/:userId/bets` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/statements/user/:userId/pdf` | `staff` + `reports:read` | **raw** `Content-Type: application/pdf` · **raw** `streamed to res` |
| `GET` | `/api/v1/admin/statements/user/:userId/statement` | `staff` + `reports:read` | `200` `service.userStatement(…)` |

### casino-service — :4003 (112 routes)

#### `aggregators`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/casino/aggregators/asia` | `public` + rate-limited | **raw** `res.json(…)` |
| `POST` | `/api/v1/casino/aggregators/evo` | `public` + rate-limited | **raw** `res.json(…)` |
| `POST` | `/api/v1/casino/aggregators/nexus` | `public` + rate-limited | **raw** `res.json(…)` |

#### `bet-history`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/casino/bet-history/live` | `public` | `200` `service.liveFeed(…)` |
| `GET` | `/api/v1/casino/bet-history` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/casino/bet-history/stats` | `player` | `200` `service.playerStats(…)` |
| `GET` | `/api/v1/casino/bet-history/timed-rounds` | `player` | `200` `service.myTimedRounds(…)` |
| `GET` | `/api/v1/admin/casino/bet-history/analytics` | `staff` + `reports:read` | `200` `service.analytics(…)` |
| `GET` | `/api/v1/admin/casino/bet-history/house/:table` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/casino/bet-history/luckysports` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/casino/bet-history/stats` | `staff` + `reports:read` | `200` `service.stats(…)` |
| `GET` | `/api/v1/admin/casino/bet-history/transactions` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/casino/bet-history/transactions/raw/:table` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/casino/bet-history/transactions/user/:userId` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/casino/bet-history/user/:userId/bet-win-count` | `staff` + `reports:read` | `200` `service.betWinCount(…)` |
| `GET` | `/internal/casino/bet-history/player/:userId/bets` | `internal` | `200` `{ bets }` |
| `GET` | `/internal/casino/bet-history/player/:userId/bets/:betId` | `internal` | `200` `{ bet }` |
| `GET` | `/internal/casino/bet-history/player/:userId/chart` | `internal` | `200` `{ chart }` |
| `GET` | `/internal/casino/bet-history/recent` | `internal` | `200` `{ bets }` |
| `GET` | `/internal/casino/bet-history/top-winners` | `internal` | `200` `{ winners }` |

#### `catalogue`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/casino/catalogue/games` | `public` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/casino/catalogue/hub/featured` | `public` | `200` `service.hubFeatured(…)` |
| `GET` | `/api/v1/casino/catalogue/hub/games` | `public` | `200` `service.hubGames(…)` |
| `GET` | `/api/v1/casino/catalogue/hub/vendors` | `public` | `200` `service.hubVendors(…)` |
| `GET` | `/api/v1/casino/catalogue/jackpots` | `public` | `200` `service.jackpots(…)` |
| `GET` | `/api/v1/casino/catalogue/nexus/games` | `public` | `200` `service.nexusGames(…)` |
| `GET` | `/api/v1/casino/catalogue/vendors` | `public` | `200` `service.localVendors(…)` |
| `POST` | `/api/v1/casino/catalogue/launch` | `player` | `201` `service.launch(…)` |
| `POST` | `/api/v1/admin/casino/catalogue/images/sync` | `staff` + `config:write` | `200` `service.syncImages(…)` |

#### `games`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/casino/games` | `public` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/casino/games/collections/:collection` | `public` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/casino/games/provider/:provider` | `public` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/casino/games/providers` | `public` | `200` `service.listProviders(…)` |
| `GET` | `/api/v1/casino/games/search` | `public` | `200` `service.search(…)` |
| `GET` | `/api/v1/casino/games/stats` | `public` | `200` `service.stats(…)` |
| `GET` | `/api/v1/casino/games/recently-played` | `player` | `200` `service.recentlyPlayed(…)` |
| `PUT` | `/api/v1/admin/casino/games/catalogue/:uuid/image` | `staff` + `casino:manage` | `200` `service.updateImage(…)` |
| `GET` | `/api/v1/admin/casino/games/catalogue/search` | `staff` + `casino:read` | `200` `service.search(…)` |
| `GET` | `/api/v1/admin/casino/games/collections/:collection` | `staff` + `casino:read` | `200` `[…]` + `meta.pagination` |
| `PUT` | `/api/v1/admin/casino/games/collections/:collection` | `staff` + `casino:manage` | `200` `service.setCollection(…)` |
| `GET` | `/api/v1/admin/casino/games/priority/:vendor` | `staff` + `casino:read` | `200` `service.vendorPriority(…)` |
| `PUT` | `/api/v1/admin/casino/games/priority/:vendor` | `staff` + `casino:manage` | `200` `service.setVendorPriority(…)` |
| `GET` | `/api/v1/admin/casino/games/providers` | `staff` + `casino:read` | `200` `service.upstreamProviders(…)` |
| `PUT` | `/api/v1/admin/casino/games/providers` | `staff` + `casino:manage` | `200` `service.setUpstreamProviders(…)` |
| `GET` | `/api/v1/admin/casino/games/type-priority/:type` | `staff` + `casino:read` | `200` `service.typePriority(…)` |
| `PUT` | `/api/v1/admin/casino/games/type-priority/:type` | `staff` + `casino:manage` | `200` `service.setTypePriority(…)` |
| `GET` | `/api/v1/admin/casino/games/type-search` | `staff` + `casino:read` | `200` `service.searchWithinType(…)` |
| `GET` | `/api/v1/admin/casino/games/types` | `staff` + `casino:read` | `200` `service.typeList(…)` |
| `GET` | `/api/v1/admin/casino/games/vendor-search` | `staff` + `casino:read` | `200` `service.searchWithinVendor(…)` |
| `GET` | `/api/v1/admin/casino/games/vendors` | `staff` + `casino:read` | `200` `service.vendorList(…)` |

#### `gis`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/casino/gis/callback/transactions` | `public` + rate-limited | **raw** `res.json(…)` |
| `GET` | `/api/v1/casino/gis/freespins/bets` | `player` | `200` `service.freespinBets(…)` |
| `GET` | `/api/v1/casino/gis/game-tags` | `player` | `200` `service.gameTags(…)` |
| `GET` | `/api/v1/casino/gis/jackpots` | `player` | `200` `service.jackpots(…)` |
| `POST` | `/api/v1/casino/gis/launch` | `player` | `201` `service.launch(…)` |
| `POST` | `/api/v1/casino/gis/launch-demo` | `player` | `201` `service.launchDemo(…)` |
| `GET` | `/api/v1/casino/gis/limits` | `player` | `200` `service.limits(…)` |
| `GET` | `/api/v1/casino/gis/limits/freespin` | `player` | `200` `service.freespinLimits(…)` |
| `GET` | `/api/v1/casino/gis/lobby` | `player` | `200` `service.lobby(…)` |
| `GET` | `/api/v1/admin/casino/gis/freespins` | `staff` + `casino:read` | `200` `service.getFreespin(…)` |
| `POST` | `/api/v1/admin/casino/gis/freespins` | `staff` + `casino:manage` | `201` `service.setFreespin(…)` |
| `POST` | `/api/v1/admin/casino/gis/freespins/cancel` | `staff` + `casino:manage` | `200` `service.cancelFreespin(…)` |
| `GET` | `/api/v1/admin/casino/gis/self-validate` | `staff` + `casino:read` | `200` `service.selfValidate(…)` |
| `POST` | `/api/v1/admin/casino/gis/sync/games` | `staff` + `casino:manage` | `200` `service.syncGames(…)` |
| `POST` | `/api/v1/admin/casino/gis/sync/providers` | `staff` + `casino:manage` | `200` `service.syncProviders(…)` |
| `GET` | `/api/v1/admin/casino/gis/vouchers` | `staff` + `casino:read` | `200` `service.getVoucher(…)` |
| `POST` | `/api/v1/admin/casino/gis/vouchers` | `staff` + `casino:manage` | `201` `service.setVoucher(…)` |
| `POST` | `/api/v1/admin/casino/gis/vouchers/cancel` | `staff` + `casino:manage` | `200` `service.cancelVoucher(…)` |

#### `house`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/casino/house` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/casino/house` | `staff` + `config:write` | `200` `service.update(…)` |
| `POST` | `/api/v1/admin/casino/house/bulk` | `staff` + `config:write` | `200` `service.bulkSet(…)` |
| `GET` | `/api/v1/admin/casino/house/clock` | `staff` + `reports:read` | `200` `{ hour, iso, serverHour, serverOffsetMinutes }` |
| `GET` | `/api/v1/admin/casino/house/ticker` | `staff` + `reports:read` | `200` `{ running }` |
| `POST` | `/api/v1/admin/casino/house/ticker` | `staff` + `config:write` | `200` `req.body.running ? ticker.start(() => service…` |

#### `js-games`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/casino/js-games/v1/bet-callback` | `public` + rate-limited | **raw** `res.json(…)` |
| `GET` | `/api/v1/casino/js-games/v1/games` | `public` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/casino/js-games/v1/games/search` | `public` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/casino/js-games/v2/bet-callback` | `public` + rate-limited | **raw** `res.json(…)` |
| `GET` | `/api/v1/casino/js-games/v2/games` | `public` | `200` `service.listGamesV2(…)` |
| `GET` | `/api/v1/casino/js-games/v2/games/search` | `public` | `200` `service.searchGamesV2(…)` |
| `POST` | `/api/v1/casino/js-games/v1/launch` | `player` | `201` `service.launchV1(…)` |
| `GET` | `/api/v1/casino/js-games/v2/history` | `player` | `200` `service.historyV2(…)` |
| `POST` | `/api/v1/casino/js-games/v2/launch` | `player` | `201` `service.launchV2(…)` |
| `POST` | `/api/v1/admin/casino/js-games/v1/transactions` | `staff` + `casino:read` | `200` `service.transactionsV1(…)` |
| `POST` | `/api/v1/admin/casino/js-games/v1/transfer` | `staff` + `wallet:credit` | `200` `service.transferV1(…)` |
| `GET` | `/api/v1/admin/casino/js-games/v2/history` | `staff` + `casino:read` | `200` `service.historyAllV2(…)` |

#### `seamless`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/casino/seamless/balance` | `public` + rate-limited | **raw** `res.json(service[method](…))` |
| `POST` | `/api/v1/casino/seamless/cancel` | `public` + rate-limited | **raw** `res.json(service[method](…))` |
| `POST` | `/api/v1/casino/seamless/deposit` | `public` + rate-limited | **raw** `res.json(service[method](…))` |
| `POST` | `/api/v1/casino/seamless/pushbet` | `public` + rate-limited | **raw** `res.json(service[method](…))` |
| `POST` | `/api/v1/casino/seamless/rollback` | `public` + rate-limited | **raw** `res.json(service[method](…))` |
| `POST` | `/api/v1/casino/seamless/transfer` | `public` + rate-limited | **raw** `res.json(service[method](…))` |
| `POST` | `/api/v1/casino/seamless/withdraw` | `public` + rate-limited | **raw** `res.json(service[method](…))` |
| `GET` | `/api/v1/casino/seamless/games` | `player` | `200` `service.games(…)` |
| `POST` | `/api/v1/casino/seamless/launch` | `player` | `201` `service.launch(…)` |
| `GET` | `/api/v1/casino/seamless/products` | `player` | `200` `service.products(…)` |

#### `sportsbook`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/casino/sportsbook` | `public` + rate-limited | `200` `service.list(…)` |
| `POST` | `/api/v1/casino/sportsbook/init` | `player` + rate-limited | `201` `service.init(…)` |
| `POST` | `/api/v1/casino/sportsbook/logout` | `player` | `200` `service.logout(…)` |
| `POST` | `/api/v1/casino/sportsbook/refresh` | `player` + rate-limited | `200` `service.refresh(…)` |
| `GET` | `/api/v1/casino/sportsbook/sessions` | `player` | `200` `service.sessions(…)` |

#### `wager-report`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/internal/casino/wager/turnover/:userId` | `internal` | `200` `service.turnover(…)` |

#### `x-casino`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/casino/x-casino/authenticate` | `public` | **raw** `res.json(…)` |
| `POST` | `/api/v1/casino/x-casino/balance` | `public` | **raw** `res.json(…)` |
| `POST` | `/api/v1/casino/x-casino/cancel` | `public` | **raw** `res.json(…)` |
| `POST` | `/api/v1/casino/x-casino/changebalance` | `public` | **raw** `res.json(…)` |
| `POST` | `/api/v1/casino/x-casino/status` | `public` | **raw** `res.json(…)` |
| `GET` | `/api/v1/casino/x-casino/balance` | `player` | `200` `service.balanceForPlayer(…)` |
| `POST` | `/api/v1/casino/x-casino/launch` | `player` | `201` `service.openGame(…)` |

#### `x-gaming`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/casino/x-gaming/by-vendor` | `public` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/casino/x-gaming/games/search` | `public` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/casino/x-gaming/vendors` | `public` | `200` `service.vendors(…)` |

### sports-service — :4004 (74 routes)

#### `bet-admin`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/sports/bet-admin/bets` | `staff` + `sports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/sports/bet-admin/bets/by-user` | `staff` + `sports:read` | `200` `service.betsByUser(…)` |
| `GET` | `/api/v1/admin/sports/bet-admin/bets/ticker` | `staff` + `sports:read` | `200` `service.ticker(…)` |
| `GET` | `/api/v1/admin/sports/bet-admin/exposure` | `staff` + `sports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/sports/bet-admin/exposure/match/:matchId` | `staff` + `sports:read` | `200` `service.marketBook(…)` |
| `GET` | `/api/v1/admin/sports/bet-admin/locks/staff` | `staff` + `sports:read` | `200` `service.staffLocks(…)` |
| `POST` | `/api/v1/admin/sports/bet-admin/locks/staff` | `staff` + `sports:manage` | `200` `service.setStaffLock(…)` |
| `GET` | `/api/v1/admin/sports/bet-admin/locks/users` | `staff` + `sports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/sports/bet-admin/locks/users` | `staff` + `sports:manage` | `200` `service.setUserLock(…)` |
| `POST` | `/api/v1/admin/sports/bet-admin/reports/game` | `staff` + `sports:read` | `200` `service.gameReport(…)` |
| `GET` | `/internal/sports/bet-admin/net` | `internal` | `200` `service.netExposure(…)` |

#### `bets`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/sports/bets` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/sports/bets` | `player` | **raw** `res.json(…)` · **raw** `res.json(…)` |
| `GET` | `/api/v1/sports/bets/exposures` | `player` | `200` `service.exposures(…)` |
| `GET` | `/api/v1/sports/bets/open-count` | `player` | `200` `service.openCount(…)` |
| `GET` | `/api/v1/sports/bets/open/:matchId` | `player` | `200` `service.openBets(…)` |
| `GET` | `/api/v1/sports/bets/summary` | `player` | `200` `service.summary(…)` |

#### `catalogue`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/sports/catalogue/sports` | `public` | `200` `service.listSports(…)` |
| `GET` | `/api/v1/admin/sports/catalogue/fancy` | `staff` + `sports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/sports/catalogue/fancy` | `staff` + `sports:manage` | `200` `service.setFancyStatus(…)` |
| `DELETE` | `/api/v1/admin/sports/catalogue/fancy/:marketId` | `staff` + `sports:manage` | `200` `service.removeFancyControl(…)` |
| `POST` | `/api/v1/admin/sports/catalogue/fancy/bulk` | `staff` + `sports:manage` | `200` `service.bulkSetFancyStatus(…)` |
| `GET` | `/api/v1/admin/sports/catalogue/fancy/event/:eventId` | `staff` + `sports:read` | `200` `service.fancyControlsForEvent(…)` |
| `GET` | `/api/v1/admin/sports/catalogue/sports` | `staff` + `sports:read` | `200` `service.listSports(…)` |
| `POST` | `/api/v1/admin/sports/catalogue/sports` | `staff` + `sports:manage` | `201` `service.addSport(…)` |
| `DELETE` | `/api/v1/admin/sports/catalogue/sports/:id` | `staff` + `sports:manage` | `200` `service.removeSport(…)` |
| `GET` | `/api/v1/admin/sports/catalogue/sports/:id` | `staff` + `sports:read` | `200` `service.getSport(…)` |
| `PUT` | `/api/v1/admin/sports/catalogue/sports/:id` | `staff` + `sports:manage` | `200` `service.updateSport(…)` |

#### `feed`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/sports/feed/events` | `public` | `200` `service.eventsBySport(…)` |
| `GET` | `/api/v1/sports/feed/events/by-series` | `public` | `200` `service.eventsBySeries(…)` |
| `GET` | `/api/v1/sports/feed/events/details` | `public` | `200` `service.eventDetails(…)` |
| `GET` | `/api/v1/sports/feed/events/list` | `public` | `200` `service.eventList(…)` |
| `GET` | `/api/v1/sports/feed/inplay` | `public` | `200` `service.inplay(…)` |
| `GET` | `/api/v1/sports/feed/inplay/all` | `public` | `200` `service.allInplay(…)` |
| `GET` | `/api/v1/sports/feed/inplay/game/:gameId` | `public` | `200` `service.inplayByGame(…)` |
| `GET` | `/api/v1/sports/feed/live/data` | `public` | `200` `service.liveSportsData(…)` |
| `GET` | `/api/v1/sports/feed/live/match` | `public` | `200` `service.liveSportsDataById(…)` |
| `GET` | `/api/v1/sports/feed/live/result` | `public` | `200` `service.liveResult(…)` |
| `GET` | `/api/v1/sports/feed/live/scorecard` | `public` | `200` `service.scorecard(…)` |
| `GET` | `/api/v1/sports/feed/live/stream` | `public` | `200` `service.liveStream(…)` |
| `GET` | `/api/v1/sports/feed/markets/details` | `public` | `200` `service.marketDetails(…)` |
| `GET` | `/api/v1/sports/feed/markets/fancy` | `public` | `200` `service.bookmakerFancy(…)` |
| `GET` | `/api/v1/sports/feed/markets/ids` | `public` | `200` `service.marketIdsV1(…)` |
| `GET` | `/api/v1/sports/feed/markets/ids/v2` | `public` | `200` `service.marketIdsV2(…)` |
| `GET` | `/api/v1/sports/feed/markets/line` | `public` | `200` `service.lineMarket(…)` |
| `GET` | `/api/v1/sports/feed/markets/odds` | `public` | `200` `service.marketOdds(…)` |
| `GET` | `/api/v1/sports/feed/matches` | `public` | `200` `service.allMatches(…)` |
| `GET` | `/api/v1/sports/feed/matches/:gameId` | `public` | `200` `service.matchesByGame(…)` |
| `GET` | `/api/v1/sports/feed/matches/date/:dateType` | `public` | `200` `service.matchesByDate(…)` |
| `GET` | `/api/v1/sports/feed/matches/date/:dateType/:gameId` | `public` | `200` `service.matchesByDateAndGame(…)` |
| `GET` | `/api/v1/sports/feed/results/event` | `public` | `200` `service.eventResult(…)` |
| `GET` | `/api/v1/sports/feed/results/list` | `public` | `200` `service.eventListResult(…)` |
| `GET` | `/api/v1/sports/feed/series` | `public` | `200` `service.series(…)` |
| `GET` | `/api/v1/sports/feed/sports` | `public` | `200` `service.allSportIds(…)` |

#### `results`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/sports/results/fancy` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/sports/results/markets` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/sports/results/fancy` | `staff` + `sports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/sports/results/markets` | `staff` + `sports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/sports/results/markets/user/:userId` | `staff` + `sports:read` | `200` `[…]` + `meta.pagination` |

#### `settlement`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/sports/settlement/my-settled-bets` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/sports/settlement/declare-result` | `staff` + `sports:settle` | **raw** `res.json(…)` |
| `GET` | `/api/v1/admin/sports/settlement/fancy-matches` | `staff` + `wallet:read` | **raw** `res.json({ success, data })` |
| `GET` | `/api/v1/admin/sports/settlement/mo-matches` | `staff` + `wallet:read` | **raw** `res.json({ success, data })` |
| `GET` | `/api/v1/admin/sports/settlement/open-bets` | `staff` + `wallet:read` | **raw** `res.json({ success, data })` |
| `GET` | `/api/v1/admin/sports/settlement/settled-bets` | `staff` + `wallet:read` | **raw** `res.json({ success, data })` |
| `GET` | `/api/v1/admin/sports/settlement/settled-markets` | `staff` + `wallet:read` | **raw** `res.json({ success, data })` |
| `POST` | `/api/v1/admin/sports/settlement/void-bet` | `staff` + `sports:settle` | **raw** `res.json({ success, message, ...result })` |
| `POST` | `/api/v1/admin/sports/settlement/void-bet/post-settlement` | `staff` + `sports:void-settled` | **raw** `res.json({ success, message, ...result })` |
| `POST` | `/api/v1/admin/sports/settlement/void-market` | `staff` + `sports:settle` | **raw** `res.json({ success, message, count, ...result })` |
| `POST` | `/api/v1/admin/sports/settlement/void-market/post-settlement` | `staff` + `sports:void-settled` | **raw** `res.json({ success, message, ...result })` |
| `GET` | `/internal/sports/settlement/pending-markets` | `internal` | `200` `service.listMarketMatches(…)` |
| `POST` | `/internal/sports/settlement/settle-market` | `internal` | `200` `service.declareResult(…)` |
| `GET` | `/internal/sports/settlement/settled-markets` | `internal` | **raw** `res.json({ success, data })` |

#### `wager-report`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/internal/sports/wager/turnover/:userId` | `internal` | `200` `service.turnover(…)` |

### user-service — :4001 (273 routes)

#### `affiliate`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/affiliate` | `player` | `200` `service.referralInfo(…)` |
| `GET` | `/api/v1/user/affiliate/rewards` | `player` | `200` `service.myRewards(…)` |
| `POST` | `/api/v1/user/affiliate/rewards/claim` | `player` | `200` `service.claimReward(…)` |
| `POST` | `/api/v1/user/affiliate/rewards/claim-all` | `player` | `200` `service.claimAllRewards(…)` |
| `GET` | `/api/v1/user/affiliate/rewards/unclaimed` | `player` | `200` `service.unclaimedRewards(…)` |
| `GET` | `/api/v1/user/affiliate/team` | `player` | `200` `service.myTeam(…)` |
| `POST` | `/api/v1/user/affiliate/team/join` | `player` | `201` `service.joinTeam(…)` |
| `GET` | `/api/v1/admin/user/affiliate/members` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/affiliate/rewards` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/affiliate/rewards` | `staff` + `config:write` | `201` `service.recordReward(…)` |
| `GET` | `/api/v1/admin/user/affiliate/stats` | `staff` + `reports:read` | `200` `service.dashboardStats(…)` |
| `GET` | `/api/v1/admin/user/affiliate/teams` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/affiliate/teams/:owner/members` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/affiliate/top` | `staff` + `reports:read` | `200` `service.topAffiliates(…)` |
| `POST` | `/api/v1/admin/user/affiliate/unlock` | `staff` + `config:write` | `200` `service.unlockFor(…)` |

#### `auth`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/user/auth/login` | `public` + rate-limited | `200` `service.login(…)` |
| `POST` | `/api/v1/user/auth/refresh` | `public` | `200` `service.refresh(…)` |
| `POST` | `/api/v1/user/auth/register` | `public` + rate-limited | `201` `service.registerAndSignIn(…)` |
| `POST` | `/api/v1/user/auth/change-password` | `player` | `200` `{ ...result, message }` |
| `POST` | `/api/v1/user/auth/logout` | `player` | `200` `service.logout(…)` |
| `GET` | `/api/v1/user/auth/me` | `player` | `200` `service.me(…)` |
| `GET` | `/api/v1/user/auth/sessions` | `player` | `200` `service.listSessions(…)` |

#### `bank-details`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/bank-details/:coin_type` | `player` | `200` `service.listActive(…)` |
| `GET` | `/api/v1/user/bank-details/:coin_type/:id/qr` | `player` | **raw** `Content-Type: image/png` · **raw** `res.send(…)` |
| `GET` | `/api/v1/admin/user/bank-details/:coin_type` | `staff` + `config:read` | `200` `service.listAll(…)` |
| `POST` | `/api/v1/admin/user/bank-details/:coin_type` | `staff` + `config:write` + upload | `201` `service.create(…)` |
| `DELETE` | `/api/v1/admin/user/bank-details/:coin_type/:id` | `staff` + `config:write` | `200` `service.deactivate(…)` |
| `PUT` | `/api/v1/admin/user/bank-details/:coin_type/:id` | `staff` + `config:write` + upload | `200` `service.update(…)` |

#### `bonus`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/bonus` | `player` | `200` `service.overview(…)` |
| `POST` | `/api/v1/user/bonus/claim/:type` | `player` | `200` `service.claim(…)` |
| `GET` | `/api/v1/user/bonus/codes` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/bonus/events` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/bonus/games` | `player` | `200` `service.myBonusGame(…)` |
| `GET` | `/api/v1/user/bonus/history` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/bonus/record` | `player` | `200` `service.myBonusRecord(…)` |
| `POST` | `/api/v1/user/bonus/redeem` | `player` | `200` `service.redeemCode(…)` |
| `GET` | `/api/v1/admin/user/bonus/awards` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/bonus/codes` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/bonus/codes` | `staff` + `config:write` | `201` `service.createCode(…)` |
| `GET` | `/api/v1/admin/user/bonus/dashboard` | `staff` + `reports:read` | `200` `service.adminDashboard(…)` |
| `GET` | `/api/v1/admin/user/bonus/events` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/bonus/events` | `staff` + `config:write` | `201` `service.createEvent(…)` |
| `DELETE` | `/api/v1/admin/user/bonus/events/:id` | `staff` + `config:write` | `200` `service.deleteEvent(…)` |
| `PUT` | `/api/v1/admin/user/bonus/events/:id` | `staff` + `config:write` | `200` `service.updateEvent(…)` |
| `DELETE` | `/api/v1/admin/user/bonus/games` | `staff` + `config:write` | `200` `service.deleteBonusGame(…)` |
| `GET` | `/api/v1/admin/user/bonus/games` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/bonus/games` | `staff` + `config:write` | `201` `service.createBonusGame(…)` · `200` `service.createBonusGame(…)` |
| `PUT` | `/api/v1/admin/user/bonus/games` | `staff` + `wallet:credit` | `200` `service.grantBonusGame(…)` |
| `DELETE` | `/api/v1/admin/user/bonus/records` | `staff` + `config:write` | `200` `service.deleteRecord(…)` |
| `GET` | `/api/v1/admin/user/bonus/records` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/bonus/records` | `staff` + `config:write` | `201` `service.createRecord(…)` |
| `PUT` | `/api/v1/admin/user/bonus/records` | `staff` + `config:write` | `200` `service.updateRecord(…)` |
| `GET` | `/api/v1/admin/user/bonus/users` | `staff` + `reports:read` | `200` `service.listUserIds(…)` |
| `GET` | `/api/v1/admin/user/bonus/users/:userId` | `staff` + `reports:read` | `200` `service.overview(…)` |

#### `club`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/user/clubs` | `player` | `201` `service.create(…)` |
| `DELETE` | `/api/v1/user/clubs/:clubId` | `player` | `200` `service.remove(…)` |
| `GET` | `/api/v1/user/clubs/:clubId` | `player` | `200` `service.getClub(…)` |
| `PUT` | `/api/v1/user/clubs/:clubId` | `player` | `200` `service.update(…)` |
| `GET` | `/api/v1/user/clubs/:clubId/earnings` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/clubs/:clubId/earnings-config` | `player` | `200` `service.earningsConfig(…)` |
| `PUT` | `/api/v1/user/clubs/:clubId/earnings-config` | `player` | `200` `service.setEarningsConfig(…)` |
| `GET` | `/api/v1/user/clubs/:clubId/hierarchy` | `player` | `200` `service.hierarchy(…)` |
| `GET` | `/api/v1/user/clubs/:clubId/members` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/user/clubs/join` | `player` | `201` `service.join(…)` |
| `POST` | `/api/v1/user/clubs/leave` | `player` | `200` `service.leave(…)` |
| `GET` | `/api/v1/user/clubs/me` | `player` | `200` `service.myMembership(…)` |
| `POST` | `/api/v1/user/clubs/members/role` | `player` | `200` `service.changeRole(…)` |
| `GET` | `/api/v1/user/clubs/owner/:ownerId` | `player` | `200` `service.ownerProfile(…)` |
| `GET` | `/api/v1/admin/user/clubs` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `DELETE` | `/api/v1/admin/user/clubs/:clubId` | `staff` + `config:write` | `200` `service.remove(…)` |
| `GET` | `/api/v1/admin/user/clubs/:clubId` | `staff` + `reports:read` | `200` `service.getClub(…)` |
| `PUT` | `/api/v1/admin/user/clubs/:clubId` | `staff` + `config:write` | `200` `service.update(…)` |
| `GET` | `/api/v1/admin/user/clubs/:clubId/earnings` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `PUT` | `/api/v1/admin/user/clubs/:clubId/earnings-config` | `staff` + `config:write` | `200` `service.setEarningsConfig(…)` |
| `GET` | `/api/v1/admin/user/clubs/:clubId/members` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/clubs/owner/:ownerId` | `staff` + `reports:read` | `200` `service.ownerProfile(…)` |

#### `club-broadcasts`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/club-broadcasts/banner-image/*` | `player` | **raw** `Content-Type: image.contentType` · **raw** `res.send(…)` |
| `PUT` | `/api/v1/user/club-broadcasts/banner-notifications/:notificationId/read` | `player` | `200` `service.markRead(…)` |
| `GET` | `/api/v1/user/club-broadcasts/clubs/:clubId/banner-notifications` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/club-broadcasts/clubs/:clubId/banners` | `player` | `200` `service.listBanners(…)` |
| `POST` | `/api/v1/user/club-broadcasts/clubs/:clubId/banners` | `player` | `201` `service.createBanner(…)` |
| `DELETE` | `/api/v1/user/club-broadcasts/clubs/:clubId/banners/:bannerId` | `player` | `200` `service.removeBanner(…)` |
| `PUT` | `/api/v1/user/club-broadcasts/clubs/:clubId/banners/:bannerId` | `player` | `200` `service.updateBanner(…)` |
| `POST` | `/api/v1/user/club-broadcasts/clubs/:clubId/banners/:bannerId/notify` | `player` | `201` `service.send(…)` |
| `GET` | `/api/v1/user/club-broadcasts/clubs/:clubId/notifications` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/user/club-broadcasts/clubs/:clubId/notifications` | `player` | `201` `service.send(…)` |
| `PUT` | `/api/v1/user/club-broadcasts/notifications/:notificationId/read` | `player` | `200` `service.markRead(…)` |

#### `crypto`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/user/crypto/ccpayment/callback` | `public` | **raw** `res.send(…)` |
| `GET` | `/api/v1/user/crypto/chains` | `public` | `200` `service.chains(…)` |
| `GET` | `/api/v1/user/crypto/coins` | `public` | `200` `service.coinDetails(…)` |
| `GET` | `/api/v1/user/crypto/inr-history` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/crypto/inr-deposits` | `staff` + `deposits:approve` | `201` `service.recordInrDeposit(…)` |

#### `crypto-withdraw`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/withdrawals/crypto` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/withdrawals/crypto/summary` | `player` | `200` `service.summary(…)` |
| `GET` | `/api/v1/admin/user/withdrawals/crypto` | `staff` + `withdrawals:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/withdrawals/crypto/:withdrawalId/decision` | `staff` + `withdrawals:approve` | `200` `service.decide(…)` |
| `GET` | `/api/v1/admin/user/withdrawals/crypto/summary` | `staff` + `withdrawals:read` | `200` `service.summary(…)` |
| `GET` | `/api/v1/admin/user/withdrawals/crypto/user/:userId` | `staff` + `withdrawals:read` | `200` `[…]` + `meta.pagination` |

#### `deposit-reports`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/user/history/crypto/deposits` | `staff` + `deposits:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/history/crypto/stats` | `staff` + `reports:read` | `200` `service.cryptoStats(…)` |
| `GET` | `/api/v1/admin/user/history/fiat/deposits` | `staff` + `deposits:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/history/fiat/stats` | `staff` + `reports:read` | `200` `service.fiatStats(…)` |
| `GET` | `/api/v1/admin/user/history/profit-loss/staff/:staffId` | `staff` + `reports:read` | `200` `service.staffProfitLoss(…)` |
| `GET` | `/api/v1/admin/user/history/profit-loss/user/:userId` | `staff` + `reports:read` | `200` `service.userProfitLoss(…)` |

#### `directory`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/admin/user/directory` | `staff` + `users:read` | `200` `[…]` + `meta.pagination` |
| `DELETE` | `/api/v1/admin/user/directory/:userId` | `staff` + `users:delete` | `200` `service.refuseDelete(…)` |
| `GET` | `/api/v1/admin/user/directory/:userId` | `staff` + `users:read` | `200` `service.get(…)` |
| `GET` | `/api/v1/admin/user/directory/summary` | `staff` + `users:read` | `200` `[…]` + `meta.pagination` |

#### `email`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/user/email/2fa/reset` | `public` | `200` `service.requestTwoFactorReset(…)` |
| `POST` | `/api/v1/user/email/2fa/reset/confirm` | `public` | `200` `service.confirmTwoFactorReset(…)` |
| `POST` | `/api/v1/user/email/otp` | `public` | `200` `service.requestOtp(…)` |
| `POST` | `/api/v1/user/email/otp/verify` | `public` | `200` `service.verifyOtp(…)` |
| `POST` | `/api/v1/admin/user/email/bulk` | `staff` + `users:write` + rate-limited | `200` `service.sendBulk(…)` |
| `POST` | `/api/v1/admin/user/email/send` | `staff` + `users:write` | `200` `service.sendToPlayer(…)` |

#### `exchange-rate`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/exchange-rate/convert` | `public` | `200` `service.convert(…)` |
| `GET` | `/api/v1/user/exchange-rate/convert/:from/:to/:amount` | `public` | `200` `service.convert(…)` |
| `GET` | `/api/v1/user/exchange-rate/rates` | `public` | `200` `service.listRates(…)` |
| `GET` | `/api/v1/user/exchange-rate/rates/:currency` | `public` | `200` `service.getRate(…)` |
| `POST` | `/api/v1/admin/user/exchange-rate/rates` | `staff` + `config:write` | `201` `service.addRate(…)` |
| `DELETE` | `/api/v1/admin/user/exchange-rate/rates/:currency` | `staff` + `config:write` | `200` `service.deleteRate(…)` |
| `PUT` | `/api/v1/admin/user/exchange-rate/rates/:currency` | `staff` + `config:write` | `200` `service.updateRate(…)` |
| `GET` | `/internal/user/exchange-rate/convert` | `internal` | `200` `service.convert(…)` |
| `GET` | `/internal/user/exchange-rate/rates` | `internal` | `200` `service.listRates(…)` |

#### `fiat-deposit`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/deposits/fiat` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/user/deposits/fiat` | `player` + upload | `201` `service.create(…)` |
| `GET` | `/api/v1/user/deposits/fiat/:depositId` | `player` | `200` `service.getForUser(…)` |
| `GET` | `/api/v1/user/deposits/fiat/:depositId/screenshot` | `player` | **raw** `Content-Type: contentType` · **raw** `res.send(…)` |
| `GET` | `/api/v1/admin/user/deposits/fiat` | `staff` + `wallet:read` | `200` `[…]` + `meta.pagination` |
| `PUT` | `/api/v1/admin/user/deposits/fiat/:depositId/approve` | `staff` + `withdrawals:approve` | `200` `service.approve(…)` |
| `PUT` | `/api/v1/admin/user/deposits/fiat/:depositId/reject` | `staff` + `withdrawals:approve` | `200` `service.reject(…)` |
| `GET` | `/api/v1/admin/user/deposits/fiat/:depositId/screenshot` | `staff` + `wallet:read` | **raw** `Content-Type: contentType` · **raw** `res.send(…)` |
| `GET` | `/api/v1/admin/user/deposits/fiat/pending` | `staff` + `wallet:read` | `200` `[…]` + `meta.pagination` |

#### `fiat-withdraw`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/withdrawals/fiat` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/user/withdrawals/fiat` | `player` | `201` `service.create(…)` |
| `GET` | `/api/v1/admin/user/withdrawals/fiat` | `staff` + `wallet:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/withdrawals/fiat/status` | `staff` + `withdrawals:approve` | `200` `service.updateStatus(…)` |

#### `gift-cards`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/gift-cards` | `player` | `200` `service.listForUser(…)` |
| `POST` | `/api/v1/user/gift-cards/activate` | `player` | `201` `service.activate(…)` |
| `POST` | `/api/v1/user/gift-cards/claim` | `player` | `200` `service.claim(…)` |
| `GET` | `/api/v1/user/gift-cards/claimed` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/gift-cards` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/gift-cards` | `staff` + `config:write` | `201` `service.create(…)` |
| `DELETE` | `/api/v1/admin/user/gift-cards/:id` | `staff` + `config:write` | `200` `service.remove(…)` |
| `GET` | `/api/v1/admin/user/gift-cards/analytics` | `staff` + `reports:read` | `200` `service.analytics(…)` |
| `GET` | `/api/v1/admin/user/gift-cards/records` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/gift-cards/search` | `staff` + `reports:read` | `200` `service.findByKey(…)` |

#### `kyc`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/kyc/documents/:kycId/:field` | `player` | **raw** `Content-Type: contentType` · **raw** `res.send(…)` |
| `GET` | `/api/v1/user/kyc/status` | `player` | `200` `service.getStatus(…)` |
| `POST` | `/api/v1/user/kyc/submit` | `player` + upload | `201` `service.submit(…)` |
| `GET` | `/api/v1/admin/user/kyc/applications` | `staff` + `wallet:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/kyc/documents/:kycId/:field` | `staff` + `wallet:read` | **raw** `Content-Type: contentType` · **raw** `res.send(…)` |
| `PUT` | `/api/v1/admin/user/kyc/review` | `staff` + `users:write` | `200` `service.review(…)` |

#### `p2p`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/user/p2p/disputes` | `player` + rate-limited | `201` `service.createDispute(…)` |
| `GET` | `/api/v1/user/p2p/disputes/:disputeId/screenshot` | `player` | **raw** `Content-Type: image.contentType` · **raw** `res.send(…)` |
| `GET` | `/api/v1/user/p2p/offers` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/p2p/order/:orderId` | `player` | `200` `service.orderDetails(…)` |
| `GET` | `/api/v1/user/p2p/orders` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/user/p2p/orders` | `player` + rate-limited | `201` `service.createOrder(…)` |
| `POST` | `/api/v1/user/p2p/orders/:orderId/paid` | `player` + rate-limited | `200` `service.markPaid(…)` |
| `GET` | `/api/v1/user/p2p/orders/:orderId/proof` | `player` | **raw** `Content-Type: image.contentType` · **raw** `res.send(…)` |
| `GET` | `/api/v1/user/p2p/sell-orders` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/user/p2p/sell-orders` | `player` + rate-limited | `201` `service.createSellOrder(…)` |
| `GET` | `/api/v1/user/p2p/sell-orders/:orderId/qr` | `player` | **raw** `Content-Type: image.contentType` · **raw** `res.send(…)` |
| `GET` | `/api/v1/admin/user/p2p/disputes` | `staff` + `config:write` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/p2p/disputes/:disputeId/screenshot` | `staff` + `config:write` | **raw** `Content-Type: image.contentType` · **raw** `res.send(…)` |
| `PATCH` | `/api/v1/admin/user/p2p/disputes/:disputeId/status` | `staff` + `config:write` | `200` `admin.setDisputeStatus(…)` |
| `GET` | `/api/v1/admin/user/p2p/offers` | `staff` + `config:write` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/p2p/offers` | `staff` + `config:write` | `201` `admin.createOffer(…)` |
| `PATCH` | `/api/v1/admin/user/p2p/offers/:offerId/status` | `staff` + `config:write` | `200` `admin.setOfferStatus(…)` |
| `GET` | `/api/v1/admin/user/p2p/orders` | `staff` + `config:write` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/p2p/orders/:orderId/cancel` | `staff` + `wallet:adjust` | `200` `admin.cancelOrder(…)` |
| `GET` | `/api/v1/admin/user/p2p/orders/:orderId/proof` | `staff` + `config:write` | **raw** `Content-Type: image.contentType` · **raw** `res.send(…)` |
| `POST` | `/api/v1/admin/user/p2p/orders/:orderId/release` | `staff` + `wallet:adjust` | `200` `admin.releaseOrder(…)` |
| `PATCH` | `/api/v1/admin/user/p2p/orders/:orderId/status` | `staff` + `config:write` | `200` `admin.setOrderStatus(…)` |
| `GET` | `/api/v1/admin/user/p2p/payment-accounts` | `staff` + `config:write` | `200` `admin.paymentAccounts(…)` |
| `POST` | `/api/v1/admin/user/p2p/payment-accounts` | `staff` + `config:write` | `201` `admin.createPaymentAccount(…)` |
| `GET` | `/api/v1/admin/user/p2p/payment-types` | `staff` + `config:write` | `200` `admin.paymentTypes(…)` |
| `POST` | `/api/v1/admin/user/p2p/payment-types` | `staff` + `config:write` | `201` `admin.createPaymentType(…)` |
| `GET` | `/api/v1/admin/user/p2p/sell-orders` | `staff` + `config:write` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/p2p/sell-orders/:orderId/cancel` | `staff` + `wallet:adjust` | `200` `admin.cancelSellOrder(…)` |
| `GET` | `/api/v1/admin/user/p2p/sell-orders/:orderId/proof` | `staff` + `config:write` | **raw** `Content-Type: image.contentType` · **raw** `res.send(…)` |
| `GET` | `/api/v1/admin/user/p2p/sell-orders/:orderId/qr` | `staff` + `config:write` | **raw** `Content-Type: image.contentType` · **raw** `res.send(…)` |
| `POST` | `/api/v1/admin/user/p2p/sell-orders/:orderId/release` | `staff` + `wallet:adjust` | `200` `admin.releaseSellOrder(…)` |

#### `payment-orders`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/user/payments/deposits` | `player` | `201` `service.createDeposit(…)` |
| `GET` | `/api/v1/user/payments/methods/:provider` | `player` | `200` `service.getAvailableMethods(…)` |
| `GET` | `/api/v1/user/payments/orders` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/payments/orders/:provider/:reference` | `player` | `200` `service.getOrder(…)` |
| `POST` | `/api/v1/user/payments/orders/:provider/:reference/refresh` | `player` | `200` `service.refreshStatus(…)` |
| `POST` | `/api/v1/user/payments/withdrawals` | `player` | `201` `service.createWithdrawal(…)` |
| `GET` | `/api/v1/admin/user/payments/users/:userId/orders` | `staff` + `deposits:read` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/admin/user/payments/utr-repair` | `staff` + `deposits:approve` | `200` `service.repairUtr(…)` |

#### `preferences`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/preferences` | `player` | `200` `service.get(…)` |
| `PATCH` | `/api/v1/user/preferences` | `player` | `200` `service.update(…)` |

#### `profile`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/profile/verify-referral/:referralCode` | `public` + rate-limited | `200` `service.verifyReferralCode(…)` |
| `GET` | `/api/v1/user/profile` | `player` | `200` `service.get(…)` |
| `PUT` | `/api/v1/user/profile` | `player` | `200` `service.update(…)` |
| `GET` | `/api/v1/user/profile/referral` | `player` | `200` `service.getReferral(…)` |

#### `psp`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/user/psp/:provider/callback` | `public` + rate-limited | **raw** `res.send(…)` · **raw** `res.json({ status, ...result })` |
| `POST` | `/api/v1/user/psp/:provider/payout-callback` | `public` + rate-limited | **raw** `res.send(…)` · **raw** `res.json({ status, ...result })` |
| `GET` | `/api/v1/user/psp/:provider/status/:reference` | `player` | `200` `service.getStatus(…)` |
| `GET` | `/api/v1/admin/user/psp/:provider/status/:reference` | `staff` + `deposits:read` | `200` `service.getStatus(…)` |

#### `rakeback`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/rakeback` | `player` | `200` `service.amount(…)` |
| `POST` | `/api/v1/user/rakeback/claim` | `player` + rate-limited | `200` `service.claim(…)` |

#### `spin-wheel`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/spin-wheel/slices` | `public` | `200` `service.publicSlices(…)` |
| `GET` | `/api/v1/user/spin-wheel/claims` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/spin-wheel/eligibility` | `player` | `200` `service.eligibility(…)` |
| `POST` | `/api/v1/user/spin-wheel/spin` | `player` + rate-limited | `201` `service.spin(…)` |
| `GET` | `/api/v1/admin/user/spin-wheel/claims` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/spin-wheel/config` | `staff` + `reports:read` | `200` `service.getConfig(…)` |
| `PUT` | `/api/v1/admin/user/spin-wheel/config` | `staff` + `config:write` | `200` `service.updateConfig(…)` |
| `GET` | `/api/v1/admin/user/spin-wheel/slices` | `staff` + `reports:read` | `200` `service.listSlices(…)` |
| `POST` | `/api/v1/admin/user/spin-wheel/slices` | `staff` + `config:write` | `201` `service.addSlice(…)` |
| `PUT` | `/api/v1/admin/user/spin-wheel/slices-bulk` | `staff` + `config:write` | `200` `service.replaceSlices(…)` |
| `DELETE` | `/api/v1/admin/user/spin-wheel/slices/:id` | `staff` + `config:write` | `200` `service.removeSlice(…)` |
| `PUT` | `/api/v1/admin/user/spin-wheel/slices/:id` | `staff` + `config:write` | `200` `service.updateSlice(…)` |

#### `swap`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/user/swap` | `player` | `200` `service.swap(…)` |
| `GET` | `/api/v1/user/swap/balances` | `player` | `200` `service.getBalances(…)` |
| `GET` | `/api/v1/user/swap/estimate` | `player` | `200` `service.estimate(…)` |
| `GET` | `/api/v1/user/swap/history` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/swap/history` | `staff` + `wallet:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/swap/history/:userId` | `staff` + `wallet:read` | `200` `[…]` + `meta.pagination` |

#### `transaction-history`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/history` | `player` | `200` `service.combined(…)` |
| `GET` | `/api/v1/user/history/crypto/deposits` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/history/crypto/stats` | `player` | `200` `service.cryptoStats(…)` |
| `GET` | `/api/v1/user/history/deposits` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/history/fiat/deposits` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/history/fiat/stats` | `player` | `200` `service.fiatStats(…)` |
| `GET` | `/api/v1/user/history/transfers` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/history/withdrawals` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/history/withdrawals/stats` | `player` | `200` `service.withdrawalStats(…)` |
| `GET` | `/api/v1/admin/user/history/deposits` | `staff` + `deposits:read | withdrawals:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/history/user/:userId` | `staff` + `deposits:read | withdrawals:read` | `200` `service.combined(…)` |
| `GET` | `/api/v1/admin/user/history/withdrawals` | `staff` + `deposits:read | withdrawals:read` | `200` `[…]` + `meta.pagination` |

#### `twofa`

| Method | Path | Guard | Response |
|---|---|---|---|
| `POST` | `/api/v1/user/2fa/disable` | `player` + rate-limited | `200` `service.disable(…)` |
| `POST` | `/api/v1/user/2fa/enable` | `player` | `200` `service.beginSetup(…)` |
| `POST` | `/api/v1/user/2fa/setup-verify` | `player` + rate-limited | `200` `service.completeSetup(…)` |
| `GET` | `/api/v1/user/2fa/status` | `player` | `200` `service.status(…)` |
| `POST` | `/api/v1/user/2fa/verify` | `player` + rate-limited | `200` `service.verify(…)` |

#### `vault`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/vault` | `player` | `200` `service.getVaultData(…)` |
| `GET` | `/api/v1/user/vault/interest` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/user/vault/lock-options` | `player` | `200` `service.listLockOptions(…)` |
| `GET` | `/api/v1/user/vault/transactions` | `player` | `200` `[…]` + `meta.pagination` |
| `POST` | `/api/v1/user/vault/transfer-in` | `player` | `201` `service.transferIn(…)` |
| `POST` | `/api/v1/user/vault/transfer-out` | `player` | `200` `service.transferOut(…)` |
| `GET` | `/api/v1/admin/user/vault/interest` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |
| `DELETE` | `/api/v1/admin/user/vault/lock-periods` | `staff` + `config:write` | `200` `service.deleteLockPeriod(…)` |
| `GET` | `/api/v1/admin/user/vault/lock-periods` | `staff` + `reports:read` | `200` `service.listLockOptions(…)` |
| `POST` | `/api/v1/admin/user/vault/lock-periods` | `staff` + `config:write` | `201` `service.addLockPeriod(…)` |
| `PUT` | `/api/v1/admin/user/vault/lock-periods/rate` | `staff` + `config:write` | `200` `service.updateRate(…)` |
| `GET` | `/api/v1/admin/user/vault/stats` | `staff` + `reports:read` | `200` `service.stats(…)` |
| `GET` | `/api/v1/admin/user/vault/users` | `staff` + `reports:read` | `200` `[…]` + `meta.pagination` |

#### `wager`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/wager/progress` | `player` | `200` `service.getProgress(…)` |
| `GET` | `/api/v1/admin/user/wager` | `staff` + `users:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/wager/:userId` | `staff` + `users:read` | `200` `service.getProgress(…)` |
| `POST` | `/api/v1/admin/user/wager/:userId` | `staff` + `users:write` | `200` `service.setForUser(…)` |
| `POST` | `/api/v1/admin/user/wager/:userId/lock` | `staff` + `users:write` | `200` `service.setLock(…)` |
| `POST` | `/api/v1/admin/user/wager/bulk/multiplier` | `staff` + `users:write` | `200` `service.setForAll(…)` |
| `GET` | `/api/v1/admin/user/wager/common` | `staff` + `users:read` | `200` `{ multiplier }` |

#### `wallet`

| Method | Path | Guard | Response |
|---|---|---|---|
| `GET` | `/api/v1/user/wallet/balances` | `player` | `200` `{ userId, balances }` |
| `GET` | `/api/v1/user/wallet/balances/:currency` | `player` | `200` `{ currency, balance }` |
| `GET` | `/api/v1/user/wallet/history` | `player` | **raw** `res.json({ history, count })` |
| `GET` | `/api/v1/user/wallet/ledger` | `player` | `200` `[…]` + `meta.pagination` |
| `GET` | `/api/v1/admin/user/wallet/:userId/balances` | `staff` + `wallet:read` | `200` `{ userId, balances }` |
| `GET` | `/api/v1/admin/user/wallet/:userId/history` | `staff` + `wallet:read` | **raw** `res.json({ history, count })` |
| `GET` | `/api/v1/admin/user/wallet/:userId/reconcile` | `staff` + `wallet:adjust` | `200` `service.reconcile(…)` |
| `POST` | `/api/v1/admin/user/wallet/adjust` | `staff` + `wallet:credit | wallet:debit` | `200` `service.adminAdjust(…)` |
| `GET` | `/api/v1/admin/user/wallet/balances` | `staff` + `wallet:read` | `200` `[…]` + `meta.pagination` |
| `GET` | `/internal/user/wallet/balance/:userId` | `internal` | `200` `currency ? { userId, currency, balance: await…` |
| `POST` | `/internal/user/wallet/credit` | `internal` | `200` `service.credit(…)` |
| `POST` | `/internal/user/wallet/debit` | `internal` | `200` `service.debit(…)` |
| `GET` | `/internal/user/wallet/reconcile/:userId` | `internal` | `200` `service.reconcile(…)` |
| `POST` | `/internal/user/wallet/rollback` | `internal` | `200` `service.rollback(…)` |
| `POST` | `/internal/user/wallet/transfer` | `internal` | `200` `service.transfer(…)` |

### Error catalogues

Each module declares every failure it can produce. A code is stable; the
message beside it is for a human and may be reworded. Errors are thrown from
the service layer, so a code is reachable from any route in its module.

#### `ACCESS` — admin/access (6)

| Status | Code | Message |
|---:|---|---|
| `404` | `ACCESS_NOT_FOUND` | Account not found |
| `404` | `ACCESS_NOT_YOURS` | Account not found |
| `409` | `ACCESS_USERNAME_TAKEN` | That username is already in use |
| `403` | `ACCESS_PERMISSION_ESCALATION` | You cannot grant a permission you do not hold yourself |
| `403` | `ACCESS_NOT_PERMITTED` | Your role does not permit that |
| `403` | `ACCESS_TRANSACTION_PASSWORD_REQUIRED` | This action requires your transaction password |

#### `ACCOUNTS` — admin/lords (6)

| Status | Code | Message |
|---:|---|---|
| `404` | `ACCOUNTS_NOT_IN_YOUR_TREE` | Account not found |
| `404` | `ACCOUNTS_NOT_FOUND` | Account not found |
| `403` | `ACCOUNTS_TRANSACTION_PASSWORD_REQUIRED` | This action requires your transaction password |
| `402` | `ACCOUNTS_INSUFFICIENT_FUNDS` | There is not enough in your balance to cover this |
| `422` | `ACCOUNTS_REFILL_TOO_LARGE` | That amount exceeds the single-refill limit |
| `422` | `ACCOUNTS_CANNOT_ACT_ON_SELF` | An account cannot do that to itself |

#### `AFFILIATE` — user/affiliate (10)

| Status | Code | Message |
|---:|---|---|
| `404` | `AFFILIATE_USER_NOT_FOUND` | Player not found |
| `404` | `AFFILIATE_NO_REFERRAL_CODE` | This account has no referral code |
| `404` | `AFFILIATE_MEMBER_NOT_FOUND` | That player is not on your team |
| `409` | `AFFILIATE_ALREADY_ON_TEAM` | That player is already on a team |
| `422` | `AFFILIATE_CANNOT_REFER_SELF` | You cannot add yourself to your own team |
| `404` | `AFFILIATE_INVALID_REFERRAL_CODE` | That referral code is not valid |
| `404` | `AFFILIATE_REWARD_NOT_FOUND` | Reward not found |
| `409` | `AFFILIATE_ALREADY_CLAIMED` | This reward has already been claimed |
| `409` | `AFFILIATE_NOTHING_TO_CLAIM` | You have no rewards to claim |
| `404` | `AFFILIATE_NOT_YOUR_REWARD` | Reward not found |

#### `AUTH` — user/auth (15)

| Status | Code | Message |
|---:|---|---|
| `401` | `AUTH_INVALID_CREDENTIALS` | Invalid username or password |
| `403` | `AUTH_ACCOUNT_LOCKED` | This account is locked. Contact support. |
| `403` | `AUTH_ACCOUNT_INACTIVE` | This account is not active |
| `429` | `AUTH_TOO_MANY_ATTEMPTS` | Too many failed sign-in attempts. Try again later. |
| `401` | `AUTH_SESSION_NOT_FOUND` | Session has expired. Please sign in again. |
| `401` | `AUTH_SESSION_REVOKED` | This session was signed out |
| `401` | `AUTH_REFRESH_TOKEN_REUSED` | This session has been ended for security reasons. Please sign in again. |
| `401` | `AUTH_TWO_FACTOR_REQUIRED` | A two-factor code is required |
| `401` | `AUTH_TWO_FACTOR_INVALID` | The two-factor code is incorrect |
| `401` | `AUTH_CURRENT_PASSWORD_INCORRECT` | Your current password is incorrect |
| `422` | `AUTH_PASSWORD_REUSED` | The new password must be different from the current one |
| `501` | `AUTH_PROVIDER_NOT_AVAILABLE` | That sign-in method is not available |
| `400` | `AUTH_RESET_TOKEN_INVALID` | That reset link is not valid or has expired |
| `409` | `AUTH_ALREADY_REGISTERED` | That username or email is already registered |
| `500` | `AUTH_REGISTRATION_FAILED` | That account could not be created |

#### `BANK_DETAILS` — user/bank-details (3)

| Status | Code | Message |
|---:|---|---|
| `404` | `BANK_DETAILS_NOT_FOUND` | Payment details not found |
| `422` | `BANK_DETAILS_UNSUPPORTED_COIN` | This currency is not supported for deposits |
| `422` | `BANK_DETAILS_INVALID_QR` | The QR image must be a JPEG or PNG under 2 MB |

#### `BANNERS` — admin/banners (7)

| Status | Code | Message |
|---:|---|---|
| `404` | `BANNERS_NOT_FOUND` | No banner for that placement |
| `400` | `BANNERS_NO_FILE` | No image was uploaded |
| `415` | `BANNERS_NOT_AN_IMAGE` | That file is not a PNG, JPEG or WebP image |
| `415` | `BANNERS_FORMAT_REFUSED` | That image format is not accepted here |
| `413` | `BANNERS_TOO_LARGE` |  |
| `400` | `BANNERS_TOO_SMALL` | That upload is too small to be an image — it may have been truncated |
| `400` | `BANNERS_BAD_TYPE` | A placement name may contain only lowercase letters, digits, dash and underscore |

#### `BET_ADMIN` — sports/bet-admin (3)

| Status | Code | Message |
|---:|---|---|
| `503` | `BET_ADMIN_VISIBILITY_UNAVAILABLE` | Could not determine which accounts you may report on |
| `404` | `BET_ADMIN_USER_NOT_FOUND` | Player not found |
| `404` | `BET_ADMIN_NOT_IN_YOUR_TREE` | Player not found |

#### `BETS` — sports/bets (8)

| Status | Code | Message |
|---:|---|---|
| `403` | `BETS_BETTING_LOCKED` | Sports betting is not available on this account |
| `404` | `BETS_MARKET_NOT_FOUND` | That market is not open for betting |
| `422` | `BETS_SELECTION_NOT_IN_MARKET` | That selection is not part of this market |
| `409` | `BETS_ODDS_REJECTED` | The price has changed — please review and place the bet again |
| `422` | `BETS_STAKE_OUT_OF_RANGE` | That stake is outside the limits for this market |
| `422` | `BETS_PAYOUT_TOO_LARGE` | That bet would exceed the maximum payout allowed on a single bet |
| `402` | `BETS_INSUFFICIENT_FUNDS` | There is not enough in your balance to cover this bet |
| `404` | `BETS_BET_NOT_FOUND` | Bet not found |

#### `BLOGS` — admin/blogs (9)

| Status | Code | Message |
|---:|---|---|
| `404` | `BLOGS_NOT_FOUND` | Blog post not found |
| `400` | `BLOGS_NO_FILE` | No image was uploaded |
| `415` | `BLOGS_NOT_AN_IMAGE` | That file is not a PNG, JPEG or WebP image |
| `415` | `BLOGS_FORMAT_REFUSED` | That image format is not accepted here |
| `413` | `BLOGS_TOO_LARGE` |  |
| `400` | `BLOGS_TOO_SMALL` | That upload is too small to be an image — it may have been truncated |
| `409` | `BLOGS_SLUG_TAKEN` | A post with that address already exists |
| `400` | `BLOGS_NOTHING_TO_UPDATE` | The request changed nothing |
| `404` | `BLOGS_NO_IMAGE` | That post has no image |

#### `BONUS` — user/bonus (11)

| Status | Code | Message |
|---:|---|---|
| `422` | `BONUS_INVALID_TYPE` | That is not a valid bonus type |
| `409` | `BONUS_NOT_CLAIMABLE` | There is no bonus of that type available to claim |
| `409` | `BONUS_ALREADY_CLAIMED` | This bonus has already been claimed |
| `410` | `BONUS_EXPIRED` | The claim window for this bonus has closed |
| `403` | `BONUS_VIP_LEVEL_TOO_LOW` | Your VIP level is not high enough for this bonus |
| `404` | `BONUS_CODE_NOT_FOUND` | That redeem code is not valid |
| `409` | `BONUS_CODE_NOT_ACTIVE` | That redeem code has already been used or has expired |
| `409` | `BONUS_CODE_EXISTS` | A redeem code with that value already exists |
| `404` | `BONUS_NO_BONUS_RECORD` | This account has no bonus record yet |
| `404` | `BONUS_NO_GAME_COUNTERS` | This account has no bonus counter record yet |
| `404` | `BONUS_EVENT_NOT_FOUND` | No such bonus log entry |

#### `CATALOGUE` — casino/catalogue (5)

| Status | Code | Message |
|---:|---|---|
| `503` | `CATALOGUE_NOT_CONFIGURED` | The casino catalogue is not configured |
| `500` | `CATALOGUE_UNKNOWN_UPSTREAM` | Unknown catalogue upstream |
| `502` | `CATALOGUE_UPSTREAM_REFUSED` | The game provider refused that request |
| `404` | `CATALOGUE_GAME_NOT_FOUND` | No such game |
| `403` | `CATALOGUE_PLAYER_LOCKED` | That account cannot play casino games |

#### `CATALOGUE` — sports/catalogue (4)

| Status | Code | Message |
|---:|---|---|
| `404` | `CATALOGUE_SPORT_NOT_FOUND` | No such sport configuration |
| `409` | `CATALOGUE_SPORT_EXISTS` | That sport is already configured |
| `404` | `CATALOGUE_FANCY_CONTROL_NOT_FOUND` | No such fancy market control |
| `422` | `CATALOGUE_NOTHING_TO_UPDATE` | Give at least one field to change |

#### `CLUB` — user/club (15)

| Status | Code | Message |
|---:|---|---|
| `404` | `CLUB_CLUB_NOT_FOUND` | Club not found |
| `410` | `CLUB_CLUB_INACTIVE` | This club is no longer accepting members |
| `409` | `CLUB_CLUB_FULL` | This club has reached its member limit |
| `404` | `CLUB_USER_NOT_FOUND` | Player not found |
| `403` | `CLUB_NOT_CLUB_OWNER` | Only the club owner can do that |
| `404` | `CLUB_NOT_A_MEMBER` | This player is not in a club |
| `409` | `CLUB_ALREADY_IN_CLUB` | This player already belongs to a club |
| `409` | `CLUB_OWNER_CANNOT_LEAVE` | A club owner cannot leave their own club |
| `422` | `CLUB_CANNOT_RECRUIT_SELF` | You cannot recruit yourself |
| `422` | `CLUB_CODE_REQUIRED` | A club code or an agent code is required |
| `404` | `CLUB_AGENT_NOT_FOUND` | That agent code is not valid |
| `422` | `CLUB_INVALID_ROLE_CHANGE` | That role change is not allowed |
| `409` | `CLUB_HAS_SUB_CLUBS` | This club has sub-clubs and cannot be deleted |
| `422` | `CLUB_PERCENTAGES_EXCEED_TOTAL` | The owner, agent and member percentages cannot exceed 100 between them |
| `503` | `CLUB_CODE_GENERATION_FAILED` | Could not allocate a code — try again |

#### `CLUBCAST` — user/club-broadcasts (9)

| Status | Code | Message |
|---:|---|---|
| `403` | `CLUBCAST_NOT_CLUB_OWNER` | Only the club owner can do that |
| `404` | `CLUBCAST_CLUB_NOT_FOUND` | Club not found |
| `404` | `CLUBCAST_BANNER_NOT_FOUND` | Banner not found |
| `404` | `CLUBCAST_NOTIFICATION_NOT_FOUND` | Notification not found |
| `403` | `CLUBCAST_NOT_A_MEMBER` | You are not a member of that club |
| `404` | `CLUBCAST_IMAGE_NOT_FOUND` | Image not found |
| `413` | `CLUBCAST_IMAGE_TOO_LARGE` | That image is too large |
| `422` | `CLUBCAST_IMAGE_TYPE_NOT_ALLOWED` | Banners must be a JPEG, PNG or WebP image |
| `409` | `CLUBCAST_TOO_MANY_BANNERS` | This club already has the maximum number of banners |

#### `CRYPTO` — user/crypto (5)

| Status | Code | Message |
|---:|---|---|
| `401` | `CRYPTO_BAD_SIGNATURE` | Signature verification failed |
| `422` | `CRYPTO_UNSUPPORTED_COIN` | That coin is not one this platform holds |
| `502` | `CRYPTO_PROVIDER_ERROR` | The payment provider rejected the request |
| `503` | `CRYPTO_NOT_CONFIGURED` | The crypto payment provider is not configured |
| `404` | `CRYPTO_PLAYER_NOT_FOUND` | Player not found |

#### `CRYPTO_WITHDRAW` — user/crypto-withdraw (10)

| Status | Code | Message |
|---:|---|---|
| `404` | `CRYPTO_WITHDRAW_NOT_FOUND` | Withdrawal not found |
| `409` | `CRYPTO_WITHDRAW_INVALID_TRANSITION` | This withdrawal cannot move to that status from where it is |
| `409` | `CRYPTO_WITHDRAW_TERMINAL` | This withdrawal has already been settled and cannot be changed |
| `422` | `CRYPTO_WITHDRAW_UNSUPPORTED_COIN` | That currency cannot be withdrawn |
| `422` | `CRYPTO_WITHDRAW_INVALID_AMOUNT` | That amount is not valid |
| `422` | `CRYPTO_WITHDRAW_INVALID_ADDRESS` | Enter a wallet address |
| `404` | `CRYPTO_WITHDRAW_PLAYER_NOT_FOUND` | Player not found |
| `401` | `CRYPTO_WITHDRAW_PASSWORD_INCORRECT` | Your password is wrong |
| `403` | `CRYPTO_WITHDRAW_ACCOUNT_LOCKED` | That account cannot withdraw |
| `422` | `CRYPTO_WITHDRAW_INSUFFICIENT_BALANCE` | Your credit is not enough |

#### `DASHBOARD` — admin/dashboard (2)

| Status | Code | Message |
|---:|---|---|
| `404` | `DASHBOARD_PLAYER_NOT_FOUND` | Player not found |
| `503` | `DASHBOARD_NO_EXCHANGE_RATES` | Exchange rates are unavailable, so USD totals cannot be computed |

#### `DEPREPORT` — user/deposit-reports (4)

| Status | Code | Message |
|---:|---|---|
| `404` | `DEPREPORT_NOT_IN_SCOPE` | Account not found |
| `503` | `DEPREPORT_VISIBILITY_UNAVAILABLE` | Cannot determine your reporting scope right now |
| `503` | `DEPREPORT_RATE_UNAVAILABLE` | No exchange rate is available to convert these figures |
| `422` | `DEPREPORT_INVALID_DATE_RANGE` | The end date is before the start date |

#### `EMAIL` — user/email (9)

| Status | Code | Message |
|---:|---|---|
| `400` | `EMAIL_OTP_INVALID` | That code is not valid |
| `410` | `EMAIL_OTP_EXPIRED` | That code has expired — request a new one |
| `429` | `EMAIL_OTP_TOO_MANY_ATTEMPTS` | Too many incorrect attempts — request a new code |
| `429` | `EMAIL_OTP_COOLDOWN` | A code was sent recently — wait before requesting another |
| `409` | `EMAIL_TWOFA_NOT_ENABLED` | Two-factor authentication is not enabled on this account |
| `502` | `EMAIL_SEND_FAILED` | The message could not be sent |
| `503` | `EMAIL_NOT_CONFIGURED` | Outbound email is not configured |
| `403` | `EMAIL_RECIPIENT_NOT_ALLOWED` | Messages may only be sent to registered players |
| `422` | `EMAIL_TOO_MANY_RECIPIENTS` | Too many recipients for one send |

#### `EXCHANGE_RATE` — user/exchange-rate (4)

| Status | Code | Message |
|---:|---|---|
| `404` | `EXCHANGE_RATE_RATE_NOT_FOUND` | No exchange rate is configured for this currency |
| `409` | `EXCHANGE_RATE_RATE_ALREADY_EXISTS` | An exchange rate already exists for this currency |
| `422` | `EXCHANGE_RATE_INVALID_RATE` | The rate must be greater than zero |
| `409` | `EXCHANGE_RATE_RATE_IN_USE` | This currency still holds player balances and cannot be removed |

#### `FEED` — sports/feed (5)

| Status | Code | Message |
|---:|---|---|
| `404` | `FEED_GAME_NOT_FOUND` | No data for that sport right now |
| `422` | `FEED_INVALID_DATE_RANGE` | That is not a date range this endpoint understands |
| `501` | `FEED_PROVIDER_NOT_CONFIGURED` | This feature needs a sports data provider that is not configured |
| `502` | `FEED_UPSTREAM_ERROR` | The sports data provider rejected the request |
| `504` | `FEED_UNREACHABLE` | The sports data provider did not respond |

#### `FIAT_DEPOSIT` — user/fiat-deposit (8)

| Status | Code | Message |
|---:|---|---|
| `404` | `FIAT_DEPOSIT_NOT_FOUND` | Deposit not found |
| `409` | `FIAT_DEPOSIT_ALREADY_PROCESSED` | This deposit has already been approved or rejected |
| `422` | `FIAT_DEPOSIT_SCREENSHOT_REQUIRED` | Proof of payment is required |
| `422` | `FIAT_DEPOSIT_INVALID_SCREENSHOT` | Proof of payment must be a JPEG, PNG or PDF |
| `413` | `FIAT_DEPOSIT_SCREENSHOT_TOO_LARGE` | Proof of payment must be 5 MB or smaller |
| `404` | `FIAT_DEPOSIT_SCREENSHOT_NOT_FOUND` | No proof of payment was attached to this deposit |
| `409` | `FIAT_DEPOSIT_DUPLICATE_TRANSACTION` | A deposit with this transaction reference already exists |
| `422` | `FIAT_DEPOSIT_REJECTION_REASON_REQUIRED` | A reason is required when rejecting a deposit |

#### `FIAT_WITHDRAW` — user/fiat-withdraw (7)

| Status | Code | Message |
|---:|---|---|
| `404` | `FIAT_WITHDRAW_NOT_FOUND` | Withdrawal request not found |
| `409` | `FIAT_WITHDRAW_ALREADY_PROCESSED` | This withdrawal has already been processed |
| `402` | `FIAT_WITHDRAW_INSUFFICIENT_BALANCE` | Insufficient balance for this withdrawal |
| `422` | `FIAT_WITHDRAW_BANK_DETAILS_REQUIRED` | Bank details are required for this currency |
| `422` | `FIAT_WITHDRAW_UPI_OR_IFSC_REQUIRED` | For INR withdrawals, either an IFSC code or a UPI id is required |
| `422` | `FIAT_WITHDRAW_BELOW_MINIMUM` | The amount is below the minimum withdrawal |
| `403` | `FIAT_WITHDRAW_KYC_REQUIRED` | Identity verification must be completed before withdrawing |

#### `GAMES` — casino/games (8)

| Status | Code | Message |
|---:|---|---|
| `404` | `GAMES_NOT_FOUND` | Game not found |
| `404` | `GAMES_UNKNOWN_COLLECTION` | No such lobby collection |
| `404` | `GAMES_PROVIDER_NOT_FOUND` | No games found for this provider |
| `422` | `GAMES_COLLECTION_TOO_LARGE` | A collection may not hold more than 5000 games |
| `422` | `GAMES_UNKNOWN_GAMES` | Some of the supplied game uuids do not exist |
| `422` | `GAMES_IMAGE_URL_INVALID` | Game image must be an absolute http(s) URL |
| `422` | `GAMES_VENDOR_REQUIRED` | A vendor is required |
| `422` | `GAMES_TYPE_REQUIRED` | A game type is required |

#### `GIFTCARD` — user/gift-cards (12)

| Status | Code | Message |
|---:|---|---|
| `404` | `GIFTCARD_NOT_FOUND` | Gift card not found |
| `409` | `GIFTCARD_KEY_TAKEN` | A gift card with this key already exists |
| `410` | `GIFTCARD_INACTIVE` | This gift card is no longer available |
| `410` | `GIFTCARD_EXPIRED` | This gift card has expired |
| `403` | `GIFTCARD_NOT_ELIGIBLE` | This gift card is not available to your account |
| `409` | `GIFTCARD_ALREADY_ACTIVATED` | You have already activated this gift card |
| `409` | `GIFTCARD_NOT_ACTIVATED` | Activate this gift card before claiming it |
| `409` | `GIFTCARD_ALREADY_CLAIMED` | This gift card has already been claimed |
| `409` | `GIFTCARD_DEPOSIT_CONDITION_UNMET` | The deposit condition for this gift card has not been met |
| `409` | `GIFTCARD_WAGER_CONDITION_UNMET` | The wagering condition for this gift card has not been met |
| `503` | `GIFTCARD_RATE_UNAVAILABLE` | No exchange rate is available to evaluate this gift card |
| `409` | `GIFTCARD_IN_USE` | Players have already activated this gift card, so it cannot be deleted |

#### `GIS` — casino/gis (13)

| Status | Code | Message |
|---:|---|---|
| `503` | `GIS_NOT_CONFIGURED` | The Slotegrator integration is not configured |
| `502` | `GIS_UPSTREAM_FAILED` | The game provider could not be reached |
| `502` | `GIS_UPSTREAM_REJECTED` | The game provider rejected the request |
| `422` | `GIS_UNSUPPORTED_CURRENCY` | That currency is not supported for casino play |
| `404` | `GIS_GAME_NOT_FOUND` | Game not found |
| `404` | `GIS_USER_NOT_FOUND` | Player not found |
| `403` | `GIS_CASINO_LOCKED` | Casino play is locked on this account |
| `404` | `GIS_FREESPIN_NOT_FOUND` | Freespin campaign not found |
| `409` | `GIS_FREESPIN_EXISTS` | A freespin campaign with this id already exists |
| `422` | `GIS_FREESPIN_BET_REQUIRED` | Provide either bet_id with denomination, or total_bet_id |
| `404` | `GIS_VOUCHER_NOT_FOUND` | Voucher not found |
| `409` | `GIS_VOUCHER_EXISTS` | A voucher with this id already exists |
| `409` | `GIS_SYNC_IN_PROGRESS` | A catalogue sync is already running |

#### `HOUSE` — casino/house (2)

| Status | Code | Message |
|---:|---|---|
| `404` | `HOUSE_NO_SUCH_ROW` | No house row for that player |
| `400` | `HOUSE_NO_TARGET` | Name the players to change, or say `scope: "all"` explicitly |

#### `INHOUSE` — casino/in-house (8)

| Status | Code | Message |
|---:|---|---|
| `422` | `INHOUSE_UNSUPPORTED_COIN` | That currency cannot be played with |
| `422` | `INHOUSE_INVALID_STAKE` | That stake is not valid |
| `422` | `INHOUSE_INSUFFICIENT_BALANCE` | Your balance is not enough |
| `404` | `INHOUSE_BET_NOT_FOUND` | No such bet |
| `409` | `INHOUSE_ALREADY_SETTLED` | That bet has already been settled |
| `404` | `INHOUSE_UNKNOWN_GAME` | No such game |
| `409` | `INHOUSE_ROUND_ALREADY_OPEN` | You already have a round of that game open |
| `404` | `INHOUSE_NO_OPEN_ROUND` | You have no round of that game open |

#### `JSGAMES` — casino/js-games (8)

| Status | Code | Message |
|---:|---|---|
| `503` | `JSGAMES_NOT_CONFIGURED` | This game provider is not configured |
| `502` | `JSGAMES_UPSTREAM_FAILED` | The game provider could not be reached |
| `502` | `JSGAMES_UPSTREAM_REJECTED` | The game provider rejected the request |
| `404` | `JSGAMES_GAME_NOT_FOUND` | Game not found or not active |
| `422` | `JSGAMES_UNSUPPORTED_CURRENCY` | That currency is not supported for this provider |
| `403` | `JSGAMES_CASINO_LOCKED` | Casino play is locked on this account |
| `422` | `JSGAMES_TRANSFER_AMOUNT_REQUIRED` | A positive transfer amount is required |
| `403` | `JSGAMES_TRANSFER_NOT_PERMITTED` | Provider wallet transfers are an operator action |

#### `KYC` — user/kyc (8)

| Status | Code | Message |
|---:|---|---|
| `404` | `KYC_NOT_FOUND` | No KYC submission exists for this account |
| `409` | `KYC_ALREADY_VERIFIED` | This account is already verified |
| `409` | `KYC_ALREADY_PENDING` | A submission is already awaiting review |
| `422` | `KYC_DOCUMENTS_REQUIRED` | At least one identity document is required |
| `422` | `KYC_REJECTION_REASON_REQUIRED` | A reason is required when rejecting a submission |
| `422` | `KYC_INVALID_FILE_TYPE` | Only JPEG, PNG and PDF files are accepted |
| `413` | `KYC_FILE_TOO_LARGE` | Each document must be 5 MB or smaller |
| `404` | `KYC_DOCUMENT_NOT_FOUND` | Document not found |

#### `LOCKS` — admin/locks (6)

| Status | Code | Message |
|---:|---|---|
| `400` | `LOCKS_NOTHING_TO_UPDATE` | No lock was named |
| `400` | `LOCKS_NO_TARGET` | Name a player or an agent to lock |
| `400` | `LOCKS_AMBIGUOUS_TARGET` | Name either a player or an agent, not both |
| `404` | `LOCKS_NOT_IN_YOUR_TREE` | No such account in your tree |
| `422` | `LOCKS_CANNOT_LOCK_SELF` | You cannot lock your own account through this route |
| `404` | `LOCKS_UNKNOWN_REFERRAL` | Unknown referral code |

#### `MARKETING` — admin/marketing (6)

| Status | Code | Message |
|---:|---|---|
| `405` | `MARKETING_READ_ONLY` | The marketing panel is read-only |
| `403` | `MARKETING_ACCOUNT_REQUIRED` | A marketing account is required |
| `403` | `MARKETING_ACCOUNT_INACTIVE` | That account is not active |
| `400` | `MARKETING_BAD_RANGE` | `from` must be before `to` |
| `400` | `MARKETING_RANGE_TOO_LARGE` |  |
| `503` | `MARKETING_NO_EXCHANGE_RATES` | Exchange rates are unavailable, so deposit volume cannot be computed |

#### `NOTIFICATIONS` — admin/notifications (4)

| Status | Code | Message |
|---:|---|---|
| `404` | `NOTIFICATIONS_NOT_IN_YOUR_TREE` | Player not found |
| `422` | `NOTIFICATIONS_NO_DEVICES` | That player has no registered device |
| `501` | `NOTIFICATIONS_PUSH_NOT_CONFIGURED` | Push delivery is not configured |
| `422` | `NOTIFICATIONS_BROADCAST_TOO_LARGE` | That broadcast would reach more devices than a single send allows |

#### `P2P` — user/p2p (25)

| Status | Code | Message |
|---:|---|---|
| `404` | `P2P_OFFER_NOT_FOUND` | Offer not found |
| `409` | `P2P_OFFER_INACTIVE` | That offer is no longer available |
| `409` | `P2P_OFFER_EXHAUSTED` | That offer does not have enough left |
| `422` | `P2P_BELOW_MIN_LIMIT` | That amount is below the offer minimum |
| `422` | `P2P_ABOVE_MAX_LIMIT` | That amount is above the offer maximum |
| `404` | `P2P_ORDER_NOT_FOUND` | Order not found |
| `409` | `P2P_ORDER_EXPIRED` | That order has expired |
| `409` | `P2P_ORDER_NOT_PENDING` | That order is no longer waiting for payment |
| `409` | `P2P_ORDER_NOT_PAID` | That order has not been marked as paid |
| `409` | `P2P_ORDER_ALREADY_SETTLED` | That order has already been settled |
| `422` | `P2P_INSUFFICIENT_BALANCE` | Not enough balance for that sell order |
| `404` | `P2P_PAYMENT_TYPE_NOT_FOUND` | Payment method not found |
| `404` | `P2P_PAYMENT_ACCOUNT_NOT_FOUND` | Payment account not found |
| `409` | `P2P_PAYMENT_TYPE_EXISTS` | A payment method with that code already exists |
| `422` | `P2P_ACCOUNT_NOT_ON_OFFER` | That payment account is not accepted by this offer |
| `404` | `P2P_DISPUTE_NOT_FOUND` | Dispute not found |
| `409` | `P2P_DISPUTE_EXISTS` | A dispute is already open on that order |
| `409` | `P2P_DISPUTE_CLOSED` | That dispute has been resolved |
| `400` | `P2P_NO_FILE` | No image was uploaded |
| `415` | `P2P_NOT_AN_IMAGE` | That file is not a PNG, JPEG or WebP image |
| `415` | `P2P_FORMAT_REFUSED` | That image format is not accepted here |
| `413` | `P2P_TOO_LARGE` |  |
| `400` | `P2P_TOO_SMALL` | That upload is too small to be an image — it may have been truncated |
| `400` | `P2P_PROOF_REQUIRED` | A payment proof is required |
| `404` | `P2P_NO_IMAGE` | There is no image on that record |

#### `PAYORDER` — user/payment-orders (13)

| Status | Code | Message |
|---:|---|---|
| `404` | `PAYORDER_UNKNOWN_PROVIDER` | Unknown payment provider |
| `503` | `PAYORDER_PROVIDER_DISABLED` | This payment provider is currently unavailable |
| `422` | `PAYORDER_CURRENCY_NOT_SUPPORTED` | This provider does not support that currency |
| `422` | `PAYORDER_METHOD_NOT_SUPPORTED` | That payment method is not available |
| `422` | `PAYORDER_BELOW_MINIMUM` | The amount is below the minimum for this provider |
| `422` | `PAYORDER_ABOVE_MAXIMUM` | The amount is above the maximum for this provider |
| `402` | `PAYORDER_INSUFFICIENT_BALANCE` | Insufficient balance for this withdrawal |
| `422` | `PAYORDER_INVALID_PAYOUT_DETAILS` | The payout details are not valid for this payment method |
| `404` | `PAYORDER_ORDER_NOT_FOUND` | Payment order not found |
| `502` | `PAYORDER_PROVIDER_REJECTED` | The payment provider rejected the request |
| `504` | `PAYORDER_PROVIDER_UNREACHABLE` | The payment provider did not respond |
| `403` | `PAYORDER_KYC_REQUIRED` | Identity verification is required before withdrawing |
| `503` | `PAYORDER_WITHDRAWALS_DISABLED` | Automatic withdrawals are currently disabled |

#### `PLAYERS` — admin/players (7)

| Status | Code | Message |
|---:|---|---|
| `404` | `PLAYERS_NOT_FOUND` | Player not found |
| `409` | `PLAYERS_ALREADY_EXISTS` | That username or email is already in use |
| `403` | `PLAYERS_NOT_PERMITTED` | You may not do that |
| `422` | `PLAYERS_INSUFFICIENT_FUNDS` | Not enough balance to fund that account |
| `409` | `PLAYERS_ALREADY_CLOSED` | That account is already closed |
| `400` | `PLAYERS_NOTHING_TO_UPDATE` | No changes were supplied |
| `403` | `PLAYERS_CANNOT_REPARENT_OUTSIDE_TREE` | A player may only be moved to an account inside your own tree |

#### `PREFERENCES` — user/preferences (4)

| Status | Code | Message |
|---:|---|---|
| `422` | `PREFERENCES_UNKNOWN_THEME` | That theme is not available |
| `422` | `PREFERENCES_UNKNOWN_LANGUAGE` | That language is not available |
| `400` | `PREFERENCES_NOTHING_TO_UPDATE` | The request changed nothing |
| `403` | `PREFERENCES_NOT_PERMITTED` | You cannot read another player’s settings |

#### `PROFILE` — user/profile (8)

| Status | Code | Message |
|---:|---|---|
| `404` | `PROFILE_USER_NOT_FOUND` | Account not found |
| `409` | `PROFILE_USERNAME_TAKEN` | That username is already in use |
| `403` | `PROFILE_USERNAME_LOCKED` | Your username cannot be changed. Contact support. |
| `404` | `PROFILE_NO_REFERRAL_CODE` | No referral code has been issued for this account |
| `409` | `PROFILE_EMAIL_TAKEN` | That email address is already in use |
| `403` | `PROFILE_EMAIL_NOT_VERIFIED` | Verify the new email address with a code before changing it |
| `400` | `PROFILE_EMAIL_UNCHANGED` | That is already the email address on this account |
| `404` | `PROFILE_NOT_FOUND` | Not found |

#### `PSP` — user/psp (10)

| Status | Code | Message |
|---:|---|---|
| `404` | `PSP_UNKNOWN_PROVIDER` | Unknown payment provider |
| `503` | `PSP_PROVIDER_DISABLED` | This payment provider is currently unavailable |
| `401` | `PSP_INVALID_SIGNATURE` | Callback rejected |
| `404` | `PSP_TRANSACTION_NOT_FOUND` | Transaction not found |
| `409` | `PSP_AMOUNT_MISMATCH` | The callback amount does not match the recorded transaction |
| `409` | `PSP_ALREADY_SETTLED` | This transaction has already been settled |
| `409` | `PSP_PAYLOAD_REPLAYED` | Callback rejected |
| `503` | `PSP_CONFIRMATION_FAILED` | Could not confirm this payment with the provider |
| `502` | `PSP_PROVIDER_ERROR` | The payment provider rejected the request |
| `504` | `PSP_PROVIDER_UNREACHABLE` | The payment provider did not respond |

#### `RAKEBACK` — user/rakeback (3)

| Status | Code | Message |
|---:|---|---|
| `409` | `RAKEBACK_NOTHING_TO_CLAIM` |  |
| `404` | `RAKEBACK_USER_NOT_FOUND` | Player not found |
| `409` | `RAKEBACK_CLAIM_IN_PROGRESS` | A rakeback claim is already being processed |

#### `REPORTS` — admin/reports (6)

| Status | Code | Message |
|---:|---|---|
| `404` | `REPORTS_PLAYER_NOT_FOUND` | Player not found |
| `404` | `REPORTS_AGENT_NOT_FOUND` | Agent not found |
| `400` | `REPORTS_BAD_RANGE` | `from` must not be after `to` |
| `400` | `REPORTS_RANGE_TOO_LARGE` | That date range is longer than a report may cover |
| `400` | `REPORTS_UNSUPPORTED_CURRENCY` | No balance sheet is kept in that currency |
| `413` | `REPORTS_EXPORT_TOO_LARGE` | That export covers more rows than one file may carry — narrow the range or filter |

#### `RESULTS` — sports/results (2)

| Status | Code | Message |
|---:|---|---|
| `503` | `RESULTS_VISIBILITY_UNAVAILABLE` | Could not determine which accounts you may report on |
| `404` | `RESULTS_NOT_IN_YOUR_TREE` | Player not found |

#### `SETTLEMENT` — sports/settlement (14)

| Status | Code | Message |
|---:|---|---|
| `404` | `SETTLEMENT_MARKET_NOT_FOUND` | No market found for the given match and market type |
| `404` | `SETTLEMENT_BET_NOT_FOUND` | Open bet not found — it may already have been settled or voided |
| `404` | `SETTLEMENT_LEDGER_ENTRY_NOT_FOUND` | Settlement entry not found |
| `404` | `SETTLEMENT_NO_SETTLED_ENTRIES` | No settled entries found for this market |
| `409` | `SETTLEMENT_NO_OPEN_BETS` | This market has no open bets to settle |
| `409` | `SETTLEMENT_MARKET_ALREADY_SETTLED` | This market has already been settled |
| `409` | `SETTLEMENT_BET_ALREADY_CLOSED` | This bet is no longer open |
| `409` | `SETTLEMENT_ALREADY_VOIDED` | This market has already been voided after settlement |
| `409` | `SETTLEMENT_SETTLEMENT_IN_PROGRESS` | Settlement is already running for this market — retry in a moment |
| `409` | `SETTLEMENT_VOID_WINDOW_EXPIRED` | The void window for this market has expired |
| `422` | `SETTLEMENT_SELECTION_REQUIRED` | This market type settles per selection, so a selection name is required |
| `422` | `SETTLEMENT_RESULT_REQUIRED` | A winner (market result) or a run value (fancy result) is required |
| `422` | `SETTLEMENT_PAYOUT_EXCEEDS_LIMIT` | The calculated payout exceeds the configured maximum for a single market |
| `502` | `SETTLEMENT_REFUND_FAILED` | The stake refund could not be completed — no balances were changed |

#### `SITE_CONFIG` — admin/site-config (4)

| Status | Code | Message |
|---:|---|---|
| `409` | `SITE_CONFIG_NOT_CONFIGURED` | There is no site configuration row to update |
| `422` | `SITE_CONFIG_NO_ALERT_INBOX` | Set a notification email address before sending a test |
| `400` | `SITE_CONFIG_NOTHING_TO_UPDATE` | Give at least one setting this endpoint can change |
| `403` | `SITE_CONFIG_PLAYER_NOT_IN_YOUR_TREE` | That player is not in your tree |

#### `SOCIAL` — user/social (9)

| Status | Code | Message |
|---:|---|---|
| `422` | `SOCIAL_UNKNOWN_ROOM` | No such chat room |
| `422` | `SOCIAL_EMPTY_MESSAGE` | A message cannot be empty |
| `422` | `SOCIAL_MESSAGE_TOO_LONG` | That message is too long |
| `403` | `SOCIAL_MUTED` | You cannot post in chat |
| `404` | `SOCIAL_PLAYER_NOT_FOUND` | No such player |
| `422` | `SOCIAL_INVALID_AVATAR` | An avatar must be a plain filename |
| `422` | `SOCIAL_CANNOT_FRIEND_SELF` | You cannot add yourself |
| `422` | `SOCIAL_CANNOT_MESSAGE_SELF` | You cannot message yourself |
| `422` | `SOCIAL_TOO_MANY_FRIENDS` | You have reached the maximum number of friends |

#### `SPIN` — user/spin-wheel (6)

| Status | Code | Message |
|---:|---|---|
| `503` | `SPIN_DISABLED` | The spin wheel is currently disabled |
| `503` | `SPIN_NO_SLICES` | The spin wheel has no prizes configured |
| `503` | `SPIN_INVALID_WEIGHTS` | The spin wheel is not correctly configured |
| `404` | `SPIN_SLICE_NOT_FOUND` | That wheel segment does not exist |
| `429` | `SPIN_COOLDOWN_ACTIVE` | You cannot spin again yet |
| `403` | `SPIN_DEPOSIT_REQUIRED` | A qualifying deposit is required before spinning again |

#### `SPORTSBOOK` — casino/sportsbook (9)

| Status | Code | Message |
|---:|---|---|
| `503` | `SPORTSBOOK_NOT_CONFIGURED` | The sportsbook integration is not configured |
| `502` | `SPORTSBOOK_UPSTREAM_FAILED` | The sportsbook provider could not be reached |
| `502` | `SPORTSBOOK_UPSTREAM_REJECTED` | The sportsbook provider rejected the request |
| `404` | `SPORTSBOOK_SESSION_NOT_FOUND` | Sportsbook session not found |
| `409` | `SPORTSBOOK_SESSION_CLOSED` | That sportsbook session has been closed |
| `409` | `SPORTSBOOK_SESSION_ALREADY_OPEN` | A session is already open on that sportsbook |
| `422` | `SPORTSBOOK_UNSUPPORTED_CURRENCY` | That currency is not supported for sportsbook play |
| `403` | `SPORTSBOOK_SPORTSBOOK_LOCKED` | Sportsbook play is locked on this account |
| `404` | `SPORTSBOOK_USER_NOT_FOUND` | Player not found |

#### `STAFF` — admin/staff (9)

| Status | Code | Message |
|---:|---|---|
| `404` | `STAFF_NOT_FOUND` | Staff account not found |
| `404` | `STAFF_NOT_IN_YOUR_TREE` | Staff account not found |
| `404` | `STAFF_PLAYER_NOT_IN_YOUR_TREE` | Player not found |
| `402` | `STAFF_INSUFFICIENT_FUNDS` | There is not enough in that balance to cover this transfer |
| `422` | `STAFF_CANNOT_TRANSFER_TO_SELF` | An account cannot transfer to itself |
| `409` | `STAFF_CANNOT_DELETE_WITH_DESCENDANTS` | This account still has accounts beneath it |
| `409` | `STAFF_CANNOT_DELETE_WITH_BALANCE` | This account still holds a balance — move it first |
| `403` | `STAFF_NOT_PERMITTED` | Your role does not permit that |
| `400` | `STAFF_OLD_PASSWORD_WRONG` | The current password is not correct |

#### `STAFF_AUTH` — admin/staff-auth (10)

| Status | Code | Message |
|---:|---|---|
| `401` | `STAFF_AUTH_INVALID_CREDENTIALS` | Those credentials are not valid |
| `403` | `STAFF_AUTH_ACCOUNT_UNAVAILABLE` | This account cannot sign in. Contact your upline. |
| `429` | `STAFF_AUTH_TOO_MANY_ATTEMPTS` | Too many sign-in attempts. Try again shortly. |
| `403` | `STAFF_AUTH_PASSWORD_CHANGE_REQUIRED` | You must set a new password before continuing |
| `401` | `STAFF_AUTH_TWO_FACTOR_REQUIRED` | Enter the 6-digit code from your authenticator app |
| `401` | `STAFF_AUTH_TWO_FACTOR_INVALID` | That code is not valid. Check your authenticator app and try again. |
| `403` | `STAFF_AUTH_TWO_FACTOR_ENROLMENT_REQUIRED` | Your role requires two-factor authentication. Ask an administrator to start enrolment for your account. |
| `409` | `STAFF_AUTH_TWO_FACTOR_ALREADY_ENABLED` | Two-factor authentication is already enabled on this account |
| `409` | `STAFF_AUTH_TWO_FACTOR_NOT_INITIATED` | Start two-factor setup before verifying a code |
| `409` | `STAFF_AUTH_TWO_FACTOR_NOT_ENABLED` | Two-factor authentication is not enabled on this account |

#### `STATEMENTS` — admin/statements (4)

| Status | Code | Message |
|---:|---|---|
| `404` | `STATEMENTS_SUBJECT_NOT_FOUND` | No such account |
| `400` | `STATEMENTS_BAD_RANGE` | `from` must not be after `to` |
| `400` | `STATEMENTS_RANGE_REQUIRED` | An agent statement needs a date range |
| `400` | `STATEMENTS_RANGE_TOO_LARGE` |  |

#### `SWAP` — user/swap (5)

| Status | Code | Message |
|---:|---|---|
| `422` | `SWAP_SAME_CURRENCY` | Cannot swap a currency into itself |
| `402` | `SWAP_INSUFFICIENT_BALANCE` | Insufficient balance for this swap |
| `409` | `SWAP_RATE_UNAVAILABLE` | No exchange rate is available for one of these currencies |
| `422` | `SWAP_AMOUNT_TOO_SMALL` | The amount is too small to convert into the target currency |
| `403` | `SWAP_SWAP_DISABLED` | Swapping is currently disabled |

#### `TWOFA` — user/twofa (5)

| Status | Code | Message |
|---:|---|---|
| `409` | `TWOFA_ALREADY_ENABLED` | Two-factor authentication is already enabled |
| `409` | `TWOFA_NOT_INITIATED` | Start two-factor setup before verifying a code |
| `409` | `TWOFA_NOT_ENABLED` | Two-factor authentication is not enabled on this account |
| `401` | `TWOFA_INVALID_CODE` | That code is not correct |
| `401` | `TWOFA_PASSWORD_REQUIRED` | Your account password is required to disable two-factor authentication |

#### `VAULT` — user/vault (9)

| Status | Code | Message |
|---:|---|---|
| `404` | `VAULT_DEPOSIT_NOT_FOUND` | Vault deposit not found |
| `404` | `VAULT_LOCK_PERIOD_NOT_FOUND` | That lock period is not available |
| `409` | `VAULT_LOCK_PERIOD_EXISTS` | A lock period with this key already exists |
| `409` | `VAULT_STILL_LOCKED` | This deposit is still within its lock period |
| `409` | `VAULT_ALREADY_WITHDRAWN` | This deposit has already been withdrawn |
| `409` | `VAULT_NOTHING_TO_WITHDRAW` | This deposit has no balance to withdraw |
| `402` | `VAULT_INSUFFICIENT_BALANCE` | Insufficient balance to move into the vault |
| `422` | `VAULT_BELOW_MINIMUM` | The amount is below the vault minimum |
| `409` | `VAULT_LOCK_PERIOD_IN_USE` | This lock period has open deposits and cannot be removed |

#### `WAGER` — user/wager (3)

| Status | Code | Message |
|---:|---|---|
| `404` | `WAGER_USER_NOT_FOUND` | Account not found |
| `409` | `WAGER_MULTIPLIER_LOCKED` | This account has a locked wagering multiplier and was not changed |
| `422` | `WAGER_INVALID_MULTIPLIER` | The multiplier must be between 0 and 100 |

#### `WALLET` — user/wallet (19)

| Status | Code | Message |
|---:|---|---|
| `402` | `WALLET_INSUFFICIENT_FUNDS` | Insufficient balance for this transaction |
| `422` | `WALLET_NEGATIVE_AMOUNT` | Amount must be greater than zero |
| `422` | `WALLET_AMOUNT_TOO_LARGE` | Amount exceeds the maximum permitted for a single transaction |
| `404` | `WALLET_WALLET_NOT_FOUND` | No wallet exists for this player |
| `422` | `WALLET_UNSUPPORTED_CURRENCY` | This currency is not supported |
| `422` | `WALLET_IDEMPOTENCY_KEY_REQUIRED` | An Idempotency-Key is required for this operation |
| `409` | `WALLET_IDEMPOTENCY_CONFLICT` | This idempotency key was already used with different parameters |
| `404` | `WALLET_LEDGER_ENTRY_NOT_FOUND` | The referenced transaction does not exist |
| `409` | `WALLET_ALREADY_ROLLED_BACK` | This transaction has already been rolled back |
| `409` | `WALLET_ROLLBACK_WOULD_GO_NEGATIVE` | Cannot roll back: the player has already spent these funds |
| `422` | `WALLET_SAME_ACCOUNT_TRANSFER` | Cannot transfer to the same account |
| `423` | `WALLET_WALLET_LOCKED` | This wallet is locked. Contact support. |
| `422` | `WALLET_CURRENCY_NOT_TIPPABLE` | That currency cannot be sent to another player |
| `422` | `WALLET_TIP_TOO_SMALL` | That amount is below the minimum |
| `404` | `WALLET_TIP_TARGET_NOT_FOUND` | No such player |
| `422` | `WALLET_TIP_TO_SELF` | You cannot tip yourself |
| `422` | `WALLET_RAIN_PLAYER_COUNT` | That is more players than one rain may reach |
| `422` | `WALLET_RAIN_NOT_ENOUGH_PLAYERS` | Not enough recent chatters to rain on |
| `422` | `WALLET_UNKNOWN_ROOM` | No such chat room |

#### `XCASINO` — casino/x-casino (15)

| Status | Code | Message |
|---:|---|---|
| `401` | `XCASINO_BAD_SIGNATURE` | Invalid hash |
| `401` | `XCASINO_STALE_REQUEST` | Request timestamp is outside the accepted window |
| `404` | `XCASINO_INVALID_SESSION` | Invalid session |
| `404` | `XCASINO_SESSION_EXPIRED` | Session has expired |
| `404` | `XCASINO_PLAYER_NOT_FOUND` | User not found |
| `403` | `XCASINO_PLAYER_LOCKED` | That account cannot play casino games |
| `422` | `XCASINO_INSUFFICIENT_FUNDS` | Insufficient balance |
| `422` | `XCASINO_UNSUPPORTED_COIN` | That currency is not held on this platform |
| `422` | `XCASINO_CURRENCY_MISMATCH` | That currency does not match the session |
| `422` | `XCASINO_UNKNOWN_TRANSACTION_TYPE` | Unknown transaction type |
| `422` | `XCASINO_NEGATIVE_AMOUNT` | An amount may not be negative |
| `409` | `XCASINO_DUPLICATE_TRANSACTION` | That transaction has already been recorded |
| `404` | `XCASINO_TRANSACTION_NOT_FOUND` | No such transaction |
| `422` | `XCASINO_CANNOT_CANCEL` | Only a bet may be cancelled |
| `503` | `XCASINO_NOT_CONFIGURED` | The casino integration is not configured |

<!-- END GENERATED: node tools/api-surface.js -->

---

## Appendix B — every legacy route

<!-- BEGIN GENERATED: node tools/route-inventory.js -->

Every route in `legacy/`, grouped by the service that will own it.

**All of these work today.** They are live in `legacy/` and serving
traffic. The marker says where a route is *served from*, not whether it
functions — **555 / 577** migrated so far (96.2%).

| | Meaning |
|---|---|
| ✅ | Migrated to the new services. The old path still works, through the gateway. |
| ⬜ | Still served by `legacy/`. Working — not yet migrated. |

## admin — 109/113

### management

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `GET` | `/admin/vault-data` | `index.js:3772` |
| ✅ | `POST` | `/adminwalletadd` | `index.js:4389` |
| ✅ | `GET` | `/all` | `Blogs/getBlogRoutes.js:6` |
| ✅ | `GET` | `/api/admin/agent-report/:staffId` | `report/routes.js:28` |
| ✅ | `GET` | `/api/admin/agent-report/:staffId/bets` | `report/routes.js:20` |
| ✅ | `GET` | `/api/admin/agent-report/:staffId/pdf` | `report/routes.js:25` |
| ✅ | `GET` | `/api/admin/agent-report/:staffId/statement` | `report/routes.js:15` |
| ✅ | `GET` | `/api/admin/agent-report/user/:userId/bets` | `report/routes.js:19` |
| ✅ | `GET` | `/api/admin/agent-report/user/:userId/pdf` | `report/routes.js:24` |
| ✅ | `GET` | `/api/admin/agent-report/user/:userId/statement` | `report/routes.js:14` |
| ✅ | `GET` | `/api/admin/balance-sheet/:userId` | `balancesheet/routes.js:9` |
| ✅ | `GET` | `/api/admin/dashboard` | `index.js:5699` |
| ✅ | `GET` | `/api/admin/user-stats` | `index.js:6044` |
| ✅ | `GET` | `/api/banners/banner/:type` | `Banners/bannerroutes.js:66` |
| ✅ | `POST` | `/api/banners/createBanner` | `Banners/bannerroutes.js:42` |
| ✅ | `GET` | `/api/banners/getAllImagesBinary` | `Banners/bannerroutes.js:124` |
| ✅ | `GET` | `/api/banners/getBannerAll` | `Banners/bannerroutes.js:76` |
| ✅ | `GET` | `/api/banners/image/:filename` | `Banners/bannerroutes.js:99` |
| ✅ | `POST` | `/api/banners/updateBanner` | `Banners/bannerroutes.js:85` |
| ✅ | `GET` | `/api/deposit/:staff_id(\\d+)?/:id/screenshot` | `system/deposit/routes.js:26` |
| ✅ | `GET` | `/api/deposit/admin/:staffId` | `system/deposit/routes.js:21` |
| ✅ | `PUT` | `/api/deposit/admin/approve/:id` | `system/deposit/routes.js:19` |
| ✅ | `GET` | `/api/deposit/admin/pending` | `system/deposit/routes.js:16` |
| ✅ | `PUT` | `/api/deposit/admin/reject/:id` | `system/deposit/routes.js:20` |
| ✅ | `POST` | `/api/deposit/create` | `system/deposit/routes.js:13` |
| ✅ | `POST` | `/api/deposit/staff-pl` | `system/deposit/routes.js:28` |
| ✅ | `POST` | `/api/deposit/user-pl` | `system/deposit/routes.js:27` |
| ✅ | `GET` | `/api/deposit/user/history/:username` | `system/deposit/routes.js:23` |
| ✅ | `GET` | `/api/members/:uid` | `index.js:3876` |
| ✅ | `GET` | `/api/public/ref/:slug` | `system/routes/public.js:6` |
| ✅ | `GET` | `/api/public/user-transfers/:uid` | `system/routes/public.js:9` |
| ✅ | `GET` | `/api/report/player/:uid` | `index.js:4309` |
| ✅ | `GET` | `/api/staff` | `system/routes/staff.js:11` |
| ✅ | `POST` | `/api/staff` | `system/routes/staff.js:17` |
| ✅ | `PATCH` | `/api/staff/:id` | `system/routes/staff.js:58` |
| ✅ | `DELETE` | `/api/staff/:id` | `system/routes/staff.js:72` |
| ✅ | `GET` | `/api/staff/:id` | `system/routes/staff.js:84` |
| ✅ | `GET` | `/api/staff/:id/percent-chain` | `system/routes/staff.js:14` |
| ✅ | `GET` | `/api/staff/:id/percent-tree` | `system/routes/staff.js:15` |
| ✅ | `GET` | `/api/staff/:id/whatsapp-ref` | `system/routes/staff.js:104` |
| ✅ | `GET` | `/api/staff/analytics/:id` | `system/routes/staff.js:87` |
| ✅ | `POST` | `/api/staff/auth/executive/login` | `system/routes/routes.js:5` |
| ✅ | `POST` | `/api/staff/auth/first-login-password` | `system/routes/routes.js:6` |
| ✅ | `POST` | `/api/staff/auth/login` | `system/routes/routes.js:4` |
| ✅ | `POST` | `/api/staff/auth/logout` | `system/routes/routes.js:7` |
| ✅ | `GET` | `/api/staff/metrics/:id` | `system/routes/staff.js:86` |
| ✅ | `PATCH` | `/api/staff/password` | `system/routes/staff.js:52` |
| ✅ | `POST` | `/api/staff/patch-bulk-status` | `system/routes/staff.js:88` |
| ✅ | `GET` | `/api/staff/players` | `system/routes/staff.js:12` |
| ✅ | `POST` | `/api/staff/players` | `system/routes/staff.js:26` |
| ✅ | `PATCH` | `/api/staff/players/:id` | `system/routes/staff.js:35` |
| ✅ | `DELETE` | `/api/staff/players/:id` | `system/routes/staff.js:78` |
| ✅ | `POST` | `/api/staff/reset-password-for-staff` | `system/routes/staff.js:106` |
| ✅ | `GET` | `/api/staff/rollup/:id` | `system/routes/staff.js:99` |
| ✅ | `GET` | `/api/staff/rollupStaff/:id` | `system/routes/staff.js:98` |
| ✅ | `GET` | `/api/staff/transactions` | `system/routes/staff.js:97` |
| ✅ | `POST` | `/api/staff/transfer` | `system/routes/staff.js:41` |
| ✅ | `GET` | `/api/staff/transfers/:id?` | `system/routes/staff.js:101` |
| ✅ | `GET` | `/api/staff/transfers/summary` | `system/routes/staff.js:102` |
| ✅ | `GET` | `/api/staff/transfers/summary/:id` | `system/routes/staff.js:103` |
| ✅ | `GET` | `/api/staff/tree` | `system/routes/staff.js:10` |
| ⬜ | `GET` | `/by-category` | `Blogs/getBlogRoutes.js:45` |
| ⬜ | `GET` | `/by-id` | `Blogs/getBlogRoutes.js:17` |
| ⬜ | `GET` | `/by-slug` | `Blogs/getBlogRoutes.js:31` |
| ✅ | `POST` | `/createBlog` | `Blogs/blogroutes.js:108` |
| ✅ | `POST` | `/deleteBlog` | `Blogs/blogroutes.js:222` |
| ✅ | `POST` | `/deleteBlogById` | `Blogs/blogroutes.js:242` |
| ✅ | `POST` | `/funds/transfer` | `system/utils/recordActivity.js:96` |
| ✅ | `POST` | `/locksystem/update-system-lock` | `locksystem/routes.js:7` |
| ✅ | `GET` | `/lords/access/activity` | `system/routes/access.js:70` |
| ✅ | `GET` | `/lords/access/executives` | `system/routes/access.js:14` |
| ✅ | `POST` | `/lords/access/executives` | `system/routes/access.js:15` |
| ✅ | `PATCH` | `/lords/access/executives/:id` | `system/routes/access.js:21` |
| ✅ | `GET` | `/lords/access/executives/:id/activity` | `system/routes/access.js:68` |
| ✅ | `PATCH` | `/lords/access/executives/:id/lock` | `system/routes/access.js:33` |
| ✅ | `PATCH` | `/lords/access/executives/:id/password` | `system/routes/access.js:27` |
| ✅ | `GET` | `/lords/access/marketing-users` | `system/routes/access.js:44` |
| ✅ | `POST` | `/lords/access/marketing-users` | `system/routes/access.js:45` |
| ✅ | `PATCH` | `/lords/access/marketing-users/:id/lock` | `system/routes/access.js:57` |
| ✅ | `PATCH` | `/lords/access/marketing-users/:id/password` | `system/routes/access.js:51` |
| ✅ | `GET` | `/lords/access/me/permissions` | `system/routes/access.js:11` |
| ✅ | `POST` | `/lords/funds/transfer` | `system/routes/lords.js:56` |
| ✅ | `GET` | `/lords/net-exposure/sports` | `system/routes/lords.js:74` |
| ✅ | `POST` | `/lords/quick-refill` | `system/routes/lords.js:45` |
| ✅ | `GET` | `/lords/transfer/statement` | `system/routes/lords.js:71` |
| ✅ | `POST` | `/lords/update-current` | `system/routes/lords.js:83` |
| ✅ | `POST` | `/lords/user-setting/exposure-limit` | `system/routes/lords.js:34` |
| ✅ | `POST` | `/lords/user-setting/status` | `system/routes/lords.js:19` |
| ✅ | `POST` | `/lords/user-setting/update-password` | `system/routes/lords.js:10` |
| ✅ | `GET` | `/lords/users/all-details` | `system/routes/lords.js:77` |
| ✅ | `GET` | `/marketing/analytics/deposits` | `system/routes/marketing.js:14` |
| ✅ | `GET` | `/marketing/analytics/retention` | `system/routes/marketing.js:15` |
| ✅ | `GET` | `/marketing/analytics/signups` | `system/routes/marketing.js:13` |
| ✅ | `GET` | `/marketing/analytics/top-agents` | `system/routes/marketing.js:16` |
| ✅ | `GET` | `/marketing/customers` | `system/routes/marketing.js:20` |
| ✅ | `GET` | `/marketing/me` | `system/routes/marketing.js:11` |
| ✅ | `GET` | `/reports/export` | `reports/routes.js:28` |
| ✅ | `GET` | `/reports/user/:userId` | `reports/routes.js:14` |
| ✅ | `GET` | `/reports/users` | `reports/routes.js:21` |
| ✅ | `GET` | `/today-deposits` | `index.js:5051` |
| ✅ | `GET` | `/today-transactions` | `index.js:5327` |
| ✅ | `GET` | `/today-withdrawals` | `index.js:5064` |
| ✅ | `GET` | `/total-deposits` | `index.js:4943` |
| ✅ | `GET` | `/total-withdrawals` | `index.js:4961` |
| ⬜ | `POST` | `/updateBlog` | `Blogs/blogroutes.js:158` |
| ✅ | `POST` | `/uploadImage` | `Blogs/blogroutes.js:90` |

### notifications

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `GET` | `/firebase/allToken` | `firabsenotifcation/routes.js:133` |
| ✅ | `GET` | `/firebase/history/:userId` | `firabsenotifcation/routes.js:120` |
| ✅ | `POST` | `/firebase/mark-as-read` | `firabsenotifcation/routes.js:101` |
| ✅ | `POST` | `/firebase/register` | `firabsenotifcation/routes.js:5` |
| ✅ | `POST` | `/firebase/send-bulk` | `firabsenotifcation/routes.js:79` |
| ✅ | `POST` | `/firebase/send-to-user` | `firabsenotifcation/routes.js:28` |
| ✅ | `GET` | `/firebase/unread-count/:userId` | `firabsenotifcation/routes.js:91` |

## casino — 117/117

### bets

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `GET` | `/betHistory/admin/analytics` | `bethistory/routes.js:34` |
| ✅ | `GET` | `/betHistory/admin/bet-history` | `bethistory/routes.js:31` |
| ✅ | `GET` | `/betHistory/transactions` | `bethistory/routes.js:16` |
| ✅ | `GET` | `/betHistory/transactions/luckysports` | `bethistory/routes.js:18` |
| ✅ | `GET` | `/betHistory/transactions/stats` | `bethistory/routes.js:24` |
| ✅ | `GET` | `/betHistory/transactions/user/:userId` | `bethistory/routes.js:21` |
| ✅ | `GET` | `/betHistory/user/:userId/bet-win-count` | `bethistory/routes.js:26` |
| ✅ | `GET` | `/betHistory/user/bet-history` | `bethistory/routes.js:29` |
| ✅ | `GET` | `/bets` | `index.js:5016` |
| ✅ | `GET` | `/transaction/live` | `index.js:4454` |
| ✅ | `GET` | `/transaction/slot` | `index.js:4485` |

### games

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `POST` | `/api/casino/authenticate` | `index.js:801` |
| ✅ | `POST` | `/api/casino/balance` | `index.js:998` |
| ✅ | `POST` | `/api/casino/cancel` | `index.js:1453` |
| ✅ | `GET` | `/api/casino/casino-balance` | `index.js:1620` |
| ✅ | `POST` | `/api/casino/changebalance` | `index.js:1178` |
| ✅ | `POST` | `/api/casino/gamerun` | `index.js:757` |
| ✅ | `GET` | `/api/casino/games/list` | `index.js:1736` |
| ✅ | `GET` | `/api/casino/games/lists` | `index.js:1765` |
| ✅ | `GET` | `/api/casino/jackpots` | `index.js:1668` |
| ✅ | `POST` | `/api/casino/status` | `index.js:1350` |
| ✅ | `GET` | `/api/casino/vendors` | `index.js:1705` |
| ✅ | `GET` | `/api/games/list` | `index.js:1791` |
| ✅ | `POST` | `/api/gis/admin/gis/crashgames` | `gis/routes.js:55` |
| ✅ | `PUT` | `/api/gis/admin/gis/games/:uuid/image` | `gis/routes.js:57` |
| ✅ | `GET` | `/api/gis/admin/gis/games/search` | `gis/routes.js:58` |
| ✅ | `POST` | `/api/gis/admin/gis/hotgames` | `gis/routes.js:52` |
| ✅ | `POST` | `/api/gis/admin/gis/indiangames` | `gis/routes.js:56` |
| ✅ | `POST` | `/api/gis/admin/gis/livecasino` | `gis/routes.js:53` |
| ✅ | `POST` | `/api/gis/admin/gis/popularslots` | `gis/routes.js:54` |
| ✅ | `GET` | `/api/gis/admin/gis/priority/:vendor` | `gis/routes.js:62` |
| ✅ | `POST` | `/api/gis/admin/gis/priority/:vendor` | `gis/routes.js:63` |
| ✅ | `GET` | `/api/gis/admin/gis/type-priority/:type` | `gis/routes.js:68` |
| ✅ | `POST` | `/api/gis/admin/gis/type-priority/:type` | `gis/routes.js:69` |
| ✅ | `GET` | `/api/gis/admin/gis/type-search` | `gis/routes.js:70` |
| ✅ | `GET` | `/api/gis/admin/gis/types` | `gis/routes.js:67` |
| ✅ | `GET` | `/api/gis/admin/gis/vendor-search` | `gis/routes.js:64` |
| ✅ | `GET` | `/api/gis/admin/gis/vendors` | `gis/routes.js:61` |
| ✅ | `GET` | `/api/gis/admin/providers` | `gis/routes.js:77` |
| ✅ | `PUT` | `/api/gis/admin/providers` | `gis/routes.js:89` |
| ✅ | `POST` | `/api/gis/callback/transactions` | `gis/routes.js:18` |
| ✅ | `GET` | `/api/gis/crashgames` | `gis/routes.js:48` |
| ✅ | `GET` | `/api/gis/freespins/bets` | `gis/routes.js:26` |
| ✅ | `POST` | `/api/gis/freespins/cancel` | `gis/routes.js:29` |
| ✅ | `GET` | `/api/gis/freespins/get` | `gis/routes.js:28` |
| ✅ | `POST` | `/api/gis/freespins/set` | `gis/routes.js:27` |
| ✅ | `POST` | `/api/gis/freevouchers/cancel` | `gis/routes.js:34` |
| ✅ | `GET` | `/api/gis/freevouchers/get` | `gis/routes.js:33` |
| ✅ | `POST` | `/api/gis/freevouchers/set` | `gis/routes.js:32` |
| ✅ | `GET` | `/api/gis/game-tags` | `gis/routes.js:7` |
| ✅ | `GET` | `/api/gis/games` | `gis/routes.js:6` |
| ✅ | `POST` | `/api/gis/games/init` | `gis/routes.js:9` |
| ✅ | `POST` | `/api/gis/games/init-demo` | `gis/routes.js:10` |
| ✅ | `GET` | `/api/gis/games/lobby` | `gis/routes.js:8` |
| ✅ | `GET` | `/api/gis/games/provider` | `gis/routes.js:12` |
| ✅ | `GET` | `/api/gis/games/recently-played` | `gis/routes.js:11` |
| ✅ | `GET` | `/api/gis/gamesgis` | `gis/routes.js:42` |
| ✅ | `GET` | `/api/gis/gamesgis/provider/:provider` | `gis/routes.js:43` |
| ✅ | `GET` | `/api/gis/gamesgis/stats` | `gis/routes.js:44` |
| ✅ | `GET` | `/api/gis/hotgames` | `gis/routes.js:45` |
| ✅ | `GET` | `/api/gis/indiangames` | `gis/routes.js:49` |
| ✅ | `GET` | `/api/gis/jackpots` | `gis/routes.js:23` |
| ✅ | `GET` | `/api/gis/limits` | `gis/routes.js:21` |
| ✅ | `GET` | `/api/gis/limits/freespin` | `gis/routes.js:22` |
| ✅ | `GET` | `/api/gis/livecasino` | `gis/routes.js:46` |
| ✅ | `GET` | `/api/gis/popularslots` | `gis/routes.js:47` |
| ✅ | `GET` | `/api/gis/providers` | `gis/routes.js:13` |
| ✅ | `GET` | `/api/gis/providersgis` | `gis/routes.js:41` |
| ✅ | `GET` | `/api/gis/self-validate` | `gis/routes.js:37` |
| ✅ | `GET` | `/api/gis/sync` | `gis/routes.js:38` |
| ✅ | `GET` | `/api/gis/sync/gamesnew` | `gis/routes.js:14` |
| ✅ | `GET` | `/api/gis/sync/providersnew` | `gis/routes.js:15` |
| ✅ | `GET` | `/bet1` | `index.js:6250` |
| ✅ | `GET` | `/bet2` | `index.js:6262` |
| ✅ | `GET` | `/bet30` | `index.js:6238` |
| ✅ | `POST` | `/game_launch` | `index.js:3592` |
| ✅ | `POST` | `/game_launch_new` | `index.js:3147` |
| ✅ | `GET` | `/game-list` | `index.js:3038` |
| ✅ | `GET` | `/game-list-new` | `index.js:3087` |
| ✅ | `GET` | `/gethouse` | `index.js:4130` |
| ✅ | `GET` | `/hour` | `index.js:2367` |
| ✅ | `POST` | `/hr` | `index.js:3989` |
| ✅ | `POST` | `/jsGames/game/bet-callback` | `jsgames/routes.js:12` |
| ✅ | `POST` | `/jsGames/game/launch` | `jsgames/routes.js:7` |
| ✅ | `POST` | `/jsGames/game/transactions` | `jsgames/routes.js:22` |
| ✅ | `POST` | `/jsGames/game/transfer` | `jsgames/routes.js:17` |
| ✅ | `GET` | `/jsGames/games` | `jsgames/routes.js:27` |
| ✅ | `GET` | `/jsGames/games/search` | `jsgames/routes.js:34` |
| ✅ | `POST` | `/jsGamesv2/bet-callback` | `jsgamesv2/gameRoutes.js:6` |
| ✅ | `GET` | `/jsGamesv2/games` | `jsgamesv2/gameRoutes.js:7` |
| ✅ | `GET` | `/jsGamesv2/games/search` | `jsgamesv2/gameRoutes.js:8` |
| ✅ | `GET` | `/jsGamesv2/history` | `jsgamesv2/gameRoutes.js:9` |
| ✅ | `GET` | `/jsGamesv2/historyAdmin` | `jsgamesv2/gameRoutes.js:10` |
| ✅ | `POST` | `/jsGamesv2/launch` | `jsgamesv2/gameRoutes.js:5` |
| ✅ | `GET` | `/reset-house` | `index.js:4112` |
| ✅ | `GET` | `/start-house` | `index.js:4102` |
| ✅ | `GET` | `/stop-house` | `index.js:4107` |
| ✅ | `POST` | `/update-gis-images-run-all` | `index.js:483` |
| ✅ | `POST` | `/update-image` | `index.js:672` |
| ✅ | `POST` | `/updatehouse` | `index.js:4143` |
| ✅ | `GET` | `/win-house` | `index.js:4121` |
| ✅ | `GET` | `/xGaming/by-vendor` | `xgamingapi/routes.js:10` |
| ✅ | `GET` | `/xGaming/games/search` | `xgamingapi/routes.js:37` |
| ✅ | `GET` | `/xGaming/vendors` | `xgamingapi/routes.js:17` |

### provider-callbacks

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `POST` | `/api/seamless/balance` | `index.js:2535` |
| ✅ | `POST` | `/api/seamless/cancel` | `index.js:2772` |
| ✅ | `POST` | `/api/seamless/deposit` | `index.js:2642` |
| ✅ | `POST` | `/api/seamless/pushbet` | `index.js:2814` |
| ✅ | `POST` | `/api/seamless/rollback` | `index.js:2730` |
| ✅ | `POST` | `/api/seamless/transfer` | `index.js:2684` |
| ✅ | `POST` | `/api/seamless/withdraw` | `index.js:2596` |
| ✅ | `POST` | `/callback_evo` | `index.js:6186` |
| ✅ | `GET` | `/fetch-games` | `index.js:2397` |
| ✅ | `GET` | `/fetch-products` | `index.js:2378` |
| ✅ | `POST` | `/gold_api` | `index.js:3578` |
| ✅ | `POST` | `/launch-game` | `index.js:2450` |
| ✅ | `GET` | `/live-bets` | `index.js:6113` |

## platform — 0/4

### infrastructure

| | Method | Path | Legacy source |
|---|---|---|---|
| ⬜ | `GET` | `/` | `index.js:2360` |
| ⬜ | `GET` | `/ccpaymentf60749fa4cee4f9dfe786aba9d7be0da.txt` | `index.js:1832` |
| ⬜ | `GET` | `/health` | `index.js:152` |
| ⬜ | `GET` | `/uploads/:name` | `index.js:6177` |

## sports — 104/105

### betting

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `GET` | `/admin/bets` | `sportsapi/bettingsports/bettingroutes.js:20` |
| ✅ | `DELETE` | `/admin/bets/:betId` | `sportsapi/bettingsports/bettingroutes.js:30` |
| ✅ | `PUT` | `/admin/bets/:betId/status` | `sportsapi/bettingsports/bettingroutes.js:25` |
| ✅ | `POST` | `/api/internalsettle/declareresult` | `mannualsettlement/routes.js:12` |
| ✅ | `GET` | `/api/internalsettle/fanmatches` | `mannualsettlement/routes.js:11` |
| ✅ | `GET` | `/api/internalsettle/momatches` | `mannualsettlement/routes.js:10` |
| ✅ | `GET` | `/api/internalsettle/open-bets` | `mannualsettlement/routes.js:42` |
| ✅ | `GET` | `/api/internalsettle/settled-bets` | `mannualsettlement/routes.js:52` |
| ✅ | `GET` | `/api/internalsettle/settled-markets` | `mannualsettlement/routes.js:51` |
| ✅ | `POST` | `/api/internalsettle/void` | `mannualsettlement/routes.js:25` |
| ✅ | `POST` | `/api/internalsettle/void-bet-after-settlement` | `mannualsettlement/routes.js:56` |
| ✅ | `POST` | `/api/internalsettle/void-market-after-settlement` | `mannualsettlement/routes.js:55` |
| ✅ | `POST` | `/api/internalsettle/void-single-bet` | `mannualsettlement/routes.js:43` |
| ✅ | `GET` | `/api/sportsmain/admin/bet-list` | `sportsmain/API/routes.js:34` |
| ✅ | `GET` | `/api/sportsmain/admin/bet-list-by-user` | `sportsmain/API/routes.js:36` |
| ✅ | `GET` | `/api/sportsmain/admin/bet-ticker` | `sportsmain/API/routes.js:35` |
| ✅ | `GET` | `/api/sportsmain/admin/betlock/staff` | `sportsmain/API/routes.js:81` |
| ✅ | `POST` | `/api/sportsmain/admin/betlock/staff/toggle` | `sportsmain/API/routes.js:101` |
| ✅ | `POST` | `/api/sportsmain/admin/betlock/user/toggle` | `sportsmain/API/routes.js:67` |
| ✅ | `GET` | `/api/sportsmain/admin/betlock/users` | `sportsmain/API/routes.js:42` |
| ✅ | `POST` | `/api/sportsmain/admin/game-report` | `sportsmain/API/routes.js:39` |
| ✅ | `GET` | `/api/sportsmain/admin/net-exposure` | `sportsmain/API/routes.js:37` |
| ✅ | `GET` | `/api/sportsmain/admin/net-exposure/market-book/:matchId` | `sportsmain/API/routes.js:38` |
| ✅ | `GET` | `/api/sportsmain/bets/exposure/:user_id` | `sportsmain/API/routes.js:19` |
| ✅ | `GET` | `/api/sportsmain/exposures/:user_id` | `sportsmain/API/routes.js:17` |
| ✅ | `POST` | `/api/sportsmain/get-all-sports-data` | `sportsmain/API/routes.js:12` |
| ✅ | `POST` | `/api/sportsmain/get-live-stream` | `sportsmain/API/routes.js:15` |
| ✅ | `POST` | `/api/sportsmain/get-result` | `sportsmain/API/routes.js:27` |
| ✅ | `POST` | `/api/sportsmain/get-scorecard` | `sportsmain/API/routes.js:16` |
| ✅ | `POST` | `/api/sportsmain/get-sports-data-id` | `sportsmain/API/routes.js:13` |
| ✅ | `GET` | `/api/sportsmain/history/:user_id/:match_id` | `sportsmain/API/routes.js:23` |
| ✅ | `POST` | `/api/sportsmain/matchexposures/match` | `sportsmain/API/routes.js:20` |
| ✅ | `GET` | `/api/sportsmain/open/:user_id/:match_id` | `sportsmain/API/routes.js:22` |
| ✅ | `GET` | `/api/sportsmain/opencount/:user_id` | `sportsmain/API/routes.js:25` |
| ✅ | `POST` | `/api/sportsmain/place-bet` | `sportsmain/API/routes.js:14` |
| ✅ | `GET` | `/api/sportsmain/user-open-bets` | `sportsmain/API/routes.js:31` |
| ✅ | `GET` | `/api/sportsmain/user-sports-open-bets` | `sportsmain/API/routes.js:29` |
| ✅ | `POST` | `/bets` | `sportsapi/bettingsports/bettingroutes.js:9` |
| ✅ | `GET` | `/event-list-result` | `sportsapi/resultroutes.js:8` |
| ✅ | `GET` | `/event-result` | `sportsapi/resultroutes.js:7` |
| ✅ | `POST` | `/sports/admin/bulk-update-fancy-status` | `sportsapi/sportsapiroutes.js:56` |
| ✅ | `DELETE` | `/sports/admin/fancy-control/:marketId` | `sportsapi/sportsapiroutes.js:57` |
| ✅ | `GET` | `/sports/admin/fancy-controls` | `sportsapi/sportsapiroutes.js:49` |
| ✅ | `GET` | `/sports/admin/fancy-controls/:eventId` | `sportsapi/sportsapiroutes.js:50` |
| ✅ | `POST` | `/sports/admin/update-fancy-status` | `sportsapi/sportsapiroutes.js:51` |
| ✅ | `GET` | `/sports/all-matches` | `sportsapi/sportsapiroutes.js:69` |
| ✅ | `GET` | `/sports/allinplay` | `sportsapi/sportsapiroutes.js:61` |
| ✅ | `GET` | `/sports/allSportsID` | `sportsapi/sportsapiroutes.js:82` |
| ✅ | `GET` | `/sports/bookmakerFancy` | `sportsapi/sportsapiroutes.js:88` |
| ✅ | `GET` | `/sports/event-details` | `sportsapi/sportsapiroutes.js:94` |
| ✅ | `GET` | `/sports/event-list-result` | `sportsapi/sportsapiroutes.js:66` |
| ✅ | `GET` | `/sports/event-result` | `sportsapi/sportsapiroutes.js:65` |
| ✅ | `GET` | `/sports/eventList` | `sportsapi/sportsapiroutes.js:93` |
| ✅ | `GET` | `/sports/getMatchesBySportsID` | `sportsapi/sportsapiroutes.js:79` |
| ✅ | `GET` | `/sports/getMatchesBySportsIDSeriesID` | `sportsapi/sportsapiroutes.js:80` |
| ✅ | `GET` | `/sports/getSeries` | `sportsapi/sportsapiroutes.js:78` |
| ✅ | `POST` | `/sports/inplay` | `sportsapi/sportsapiroutes.js:60` |
| ✅ | `GET` | `/sports/inplayGameId/:gameId` | `sportsapi/sportsapiroutes.js:62` |
| ✅ | `GET` | `/sports/lineMarket` | `sportsapi/sportsapiroutes.js:89` |
| ✅ | `GET` | `/sports/market-ids-v1` | `sportsapi/sportsapiroutes.js:85` |
| ✅ | `GET` | `/sports/market-ids-v2` | `sportsapi/sportsapiroutes.js:86` |
| ✅ | `GET` | `/sports/market-odds` | `sportsapi/sportsapiroutes.js:87` |
| ✅ | `GET` | `/sports/marketDetails` | `sportsapi/sportsapiroutes.js:90` |
| ✅ | `GET` | `/sports/matches-by-date/:dateType` | `sportsapi/sportsapiroutes.js:71` |
| ✅ | `GET` | `/sports/matches/:dateType/:gameId` | `sportsapi/sportsapiroutes.js:75` |
| ✅ | `GET` | `/sports/matches/:gameId` | `sportsapi/sportsapiroutes.js:70` |
| ✅ | `GET` | `/sports/sports` | `sportsapi/sportsapiroutes.js:103` |
| ✅ | `GET` | `/sports/sports-config` | `sportsapi/sportsapiroutes.js:97` |
| ✅ | `POST` | `/sports/sports-config` | `sportsapi/sportsapiroutes.js:98` |
| ✅ | `PUT` | `/sports/sports-config/:id` | `sportsapi/sportsapiroutes.js:99` |
| ✅ | `DELETE` | `/sports/sports-config/:id` | `sportsapi/sportsapiroutes.js:100` |
| ✅ | `GET` | `/sports/sports/:id` | `sportsapi/sportsapiroutes.js:104` |
| ✅ | `PUT` | `/sports/sports/:id` | `sportsapi/sportsapiroutes.js:105` |
| ✅ | `GET` | `/sportsbetting` | `sportsbet/routes.js:397` |
| ✅ | `GET` | `/sportsbetting/admin/bets` | `sportsbet/routes.js:1369` |
| ✅ | `DELETE` | `/sportsbetting/admin/bets/:id` | `sportsbet/routes.js:1371` |
| ✅ | `PUT` | `/sportsbetting/admin/bets/:id/status` | `sportsbet/routes.js:1370` |
| ✅ | `POST` | `/sportsbetting/calculate-payouts` | `sportsbet/routes.js:1366` |
| ✅ | `GET` | `/sportsbetting/exposures/:user_id` | `sportsbet/routes.js:17` |
| ✅ | `GET` | `/sportsbetting/FAN/:id` | `sportsbet/routes.js:619` |
| ✅ | `POST` | `/sportsbetting/fancymanualsettle` | `sportsbet/routes.js:1361` |
| ✅ | `GET` | `/sportsbetting/fancynotsettle` | `sportsbet/routes.js:1359` |
| ✅ | `POST` | `/sportsbetting/fancyrefundsettle` | `sportsbet/routes.js:1360` |
| ✅ | `GET` | `/sportsbetting/fanmatches` | `sportsbet/routes.js:1363` |
| ✅ | `POST` | `/sportsbetting/fanpayouts` | `sportsbet/routes.js:1362` |
| ✅ | `GET` | `/sportsbetting/fanwins` | `sportsbet/routes.js:635` |
| ✅ | `GET` | `/sportsbetting/history/:userUuid` | `sportsbet/routes.js:54` |
| ✅ | `POST` | `/sportsbetting/manual-settlement` | `sportsbet/routes.js:1364` |
| ✅ | `GET` | `/sportsbetting/marketwins` | `sportsbet/routes.js:483` |
| ✅ | `GET` | `/sportsbetting/MO/:id` | `sportsbet/routes.js:589` |
| ✅ | `GET` | `/sportsbetting/momatches` | `sportsbet/routes.js:1367` |
| ✅ | `GET` | `/sportsbetting/open/:userUuid/:matchId` | `sportsbet/routes.js:23` |
| ✅ | `GET` | `/sportsbetting/opencount/:userUuid` | `sportsbet/routes.js:79` |
| ✅ | `PUT` | `/sportsbetting/password/:userUuid` | `sportsbet/routes.js:152` |
| ✅ | `POST` | `/sportsbetting/place` | `sportsbet/routes.js:16` |
| ✅ | `GET` | `/sportsbetting/settle` | `sportsbet/routes.js:1372` |
| ✅ | `GET` | `/sportsbetting/transfers/:userUuid` | `sportsbet/routes.js:112` |
| ✅ | `GET` | `/sportsbetting/wallet/:uuid` | `sportsbet/routes.js:20` |
| ✅ | `GET` | `/sportsbooks` | `sportsbook/routes.js:6` |
| ✅ | `POST` | `/sportsbooks/init` | `sportsbook/routes.js:7` |
| ⬜ | `GET` | `/sportsbooks/launch` | `sportsbook/routes.js:8` |
| ✅ | `POST` | `/sportsbooks/logout` | `sportsbook/routes.js:9` |
| ✅ | `POST` | `/sportsbooks/refresh-token` | `sportsbook/routes.js:10` |
| ✅ | `GET` | `/sportsCheck` | `index.js:1635` |
| ✅ | `GET` | `/users/:userId/bets` | `sportsapi/bettingsports/bettingroutes.js:14` |

## user — 225/238

### accounts

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `POST` | `/2fa/disable` | `2fa/routes.js:139` |
| ✅ | `POST` | `/2fa/enable` | `2fa/routes.js:33` |
| ✅ | `POST` | `/2fa/setup-verify` | `2fa/routes.js:72` |
| ✅ | `GET` | `/2fa/status/:uid` | `2fa/routes.js:8` |
| ✅ | `POST` | `/2fa/verify` | `2fa/routes.js:108` |
| ✅ | `GET` | `/bankdetails/:coin_type` | `BankDetails/bankroutes.js:13` |
| ✅ | `POST` | `/bankdetails/:coin_type` | `BankDetails/bankroutes.js:18` |
| ✅ | `PUT` | `/bankdetails/:coin_type/:id` | `BankDetails/bankroutes.js:24` |
| ✅ | `DELETE` | `/bankdetails/:coin_type/:id` | `BankDetails/bankroutes.js:30` |
| ✅ | `DELETE` | `/deleteUser` | `index.js:4555` |
| ✅ | `PUT` | `/editProfile` | `index.js:3810` |
| ✅ | `POST` | `/email/2fa/reset` | `emailservice/routes.js:196` |
| ✅ | `POST` | `/email/2fa/reset-verify` | `emailservice/routes.js:242` |
| ✅ | `POST` | `/email/email/bulk` | `emailservice/routes.js:169` |
| ✅ | `POST` | `/email/email/send` | `emailservice/routes.js:148` |
| ✅ | `POST` | `/email/otp/resend` | `emailservice/routes.js:106` |
| ✅ | `POST` | `/email/otp/send` | `emailservice/routes.js:83` |
| ✅ | `POST` | `/email/otp/verify` | `emailservice/routes.js:131` |
| ✅ | `GET` | `/email/settings` | `emailservice/routes.js:28` |
| ✅ | `PUT` | `/email/settings` | `emailservice/routes.js:47` |
| ✅ | `POST` | `/email/settings/test` | `emailservice/routes.js:66` |
| ✅ | `GET` | `/getUserData` | `index.js:4934` |
| ✅ | `GET` | `/kyc/admin/applications` | `kyc/routes.js:16` |
| ✅ | `GET` | `/kyc/documents/:filename` | `kyc/routes.js:18` |
| ✅ | `GET` | `/kyc/status/:userId` | `kyc/routes.js:8` |
| ✅ | `POST` | `/kyc/submit` | `kyc/routes.js:11` |
| ✅ | `PUT` | `/kyc/update-status` | `kyc/routes.js:14` |
| ✅ | `POST` | `/send-otp` | `index.js:3996` |
| ✅ | `GET` | `/user-summary` | `index.js:5026` |
| ✅ | `GET` | `/user/api/balance` | `Users/routes.js:7` |
| ✅ | `POST` | `/user/change-password` | `index.js:2319` |
| ✅ | `GET` | `/users` | `index.js:4978` |

### payment-callbacks

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `POST` | `/api/ccpaymentnotify` | `index.js:2186` |
| ⬜ | `GET` | `/blockNotify` | `index.js:6154` |
| ⬜ | `GET` | `/crypto_callbacks` | `index.js:6162` |
| ✅ | `POST` | `/processRequest` | `index.js:3416` |
| ✅ | `POST` | `/webhook/paymentstatuspui` | `index.js:604` |

### payments

| | Method | Path | Legacy source |
|---|---|---|---|
| ⬜ | `POST` | `/admin/add-lock-period` | `vaultpro/routes.js:16` |
| ⬜ | `POST` | `/admin/delete-lock-period` | `vaultpro/routes.js:17` |
| ✅ | `POST` | `/admin/p2p/cancel/:orderId` | `peerTrade/routes.js:21` |
| ✅ | `POST` | `/admin/p2p/create-offer` | `peerTrade/routes.js:12` |
| ✅ | `PUT` | `/admin/p2p/dispute/:disputeId/status` | `peerTrade/routes.js:35` |
| ✅ | `GET` | `/admin/p2p/disputes` | `peerTrade/routes.js:34` |
| ✅ | `GET` | `/admin/p2p/offers` | `peerTrade/routes.js:17` |
| ⬜ | `DELETE` | `/admin/p2p/order/:orderId` | `peerTrade/routes.js:22` |
| ✅ | `PUT` | `/admin/p2p/order/:orderId/status` | `peerTrade/routes.js:23` |
| ✅ | `GET` | `/admin/p2p/orders` | `peerTrade/routes.js:18` |
| ✅ | `POST` | `/admin/p2p/payment-account` | `peerTrade/routes.js:11` |
| ✅ | `GET` | `/admin/p2p/payment-accounts` | `peerTrade/routes.js:16` |
| ✅ | `POST` | `/admin/p2p/payment-type` | `peerTrade/routes.js:10` |
| ✅ | `GET` | `/admin/p2p/payment-types` | `peerTrade/routes.js:15` |
| ✅ | `POST` | `/admin/p2p/release/:orderId` | `peerTrade/routes.js:13` |
| ✅ | `POST` | `/admin/p2p/sell-cancel/:orderId` | `peerTrade/routes.js:32` |
| ✅ | `GET` | `/admin/p2p/sell-orders` | `peerTrade/routes.js:19` |
| ✅ | `POST` | `/admin/p2p/sell-release/:orderId` | `peerTrade/routes.js:26` |
| ⬜ | `POST` | `/admin/update-interest` | `vaultpro/routes.js:15` |
| ⬜ | `GET` | `/admin/vault/interest-history` | `vaultpro/routes.js:21` |
| ⬜ | `GET` | `/admin/vault/stats` | `vaultpro/routes.js:20` |
| ⬜ | `GET` | `/admin/vault/users` | `vaultpro/routes.js:19` |
| ✅ | `GET` | `/api/depositNew` | `index.js:5157` |
| ✅ | `GET` | `/api/deposits/admin/all-deposits` | `fiatdeposit/routes.js:48` |
| ✅ | `GET` | `/api/deposits/admin/all-wagers` | `fiatdeposit/routes.js:45` |
| ✅ | `PUT` | `/api/deposits/admin/approve/:depositId` | `fiatdeposit/routes.js:50` |
| ✅ | `GET` | `/api/deposits/admin/common-targetx` | `fiatdeposit/routes.js:39` |
| ✅ | `GET` | `/api/deposits/admin/pending-deposits` | `fiatdeposit/routes.js:49` |
| ✅ | `PUT` | `/api/deposits/admin/reject/:depositId` | `fiatdeposit/routes.js:51` |
| ✅ | `POST` | `/api/deposits/admin/targetx/:id` | `fiatdeposit/routes.js:40` |
| ✅ | `POST` | `/api/deposits/admin/targetx/:id/lock` | `fiatdeposit/routes.js:42` |
| ✅ | `POST` | `/api/deposits/admin/update-all-targetx` | `fiatdeposit/routes.js:41` |
| ✅ | `GET` | `/api/deposits/check-wager/:uid` | `fiatdeposit/routes.js:36` |
| ✅ | `POST` | `/api/deposits/create` | `fiatdeposit/routes.js:31` |
| ✅ | `GET` | `/api/deposits/deposit/:depositId` | `fiatdeposit/routes.js:33` |
| ✅ | `GET` | `/api/deposits/screenshot/:depositId` | `fiatdeposit/routes.js:34` |
| ✅ | `GET` | `/api/deposits/user-deposits` | `fiatdeposit/routes.js:32` |
| ✅ | `POST` | `/api/payments/payin/callback` | `waypay/routes.js:8` |
| ✅ | `POST` | `/api/payments/payin/initiate` | `waypay/routes.js:7` |
| ✅ | `GET` | `/api/payments/payin/status/:out_trade_no` | `waypay/routes.js:9` |
| ✅ | `POST` | `/api/payments/payout/callback` | `waypay/routes.js:13` |
| ✅ | `POST` | `/api/payments/payout/initiate` | `waypay/routes.js:12` |
| ✅ | `GET` | `/api/payments/payout/status/:out_trade_no` | `waypay/routes.js:14` |
| ✅ | `POST` | `/api/payments/utr/repair` | `waypay/routes.js:17` |
| ✅ | `GET` | `/api/withdrawNew` | `index.js:5254` |
| ✅ | `POST` | `/checkorderstatusupi` | `index.js:408` |
| ✅ | `POST` | `/createDeposit` | `index.js:1837` |
| ✅ | `POST` | `/createFiatWithdrawal` | `fiatwithdraw/routes.js:10` |
| ✅ | `POST` | `/createorderupi` | `index.js:303` |
| ✅ | `GET` | `/cricpay/check-payment-status` | `cricpay/routes.js:6` |
| ✅ | `POST` | `/cricpay/check-transaction-status` | `cricpay/routes.js:8` |
| ✅ | `POST` | `/cricpay/payment-callback` | `cricpay/routes.js:10` |
| ✅ | `POST` | `/cricpay/payment-request` | `cricpay/routes.js:7` |
| ✅ | `POST` | `/cricpay/payout-request` | `cricpay/routes.js:9` |
| ✅ | `GET` | `/depositHistory/crypto/deposits` | `depositHistory/routes.js:31` |
| ✅ | `GET` | `/depositHistory/crypto/stats` | `depositHistory/routes.js:176` |
| ✅ | `GET` | `/depositHistory/fiat/deposits` | `depositHistory/routes.js:221` |
| ✅ | `GET` | `/depositHistory/fiat/stats` | `depositHistory/routes.js:536` |
| ✅ | `GET` | `/deposits` | `index.js:4988` |
| ✅ | `GET` | `/getDepositData` | `index.js:4803` |
| ✅ | `GET` | `/getFiatWithdrawData` | `fiatwithdraw/routes.js:6` |
| ✅ | `POST` | `/getOrder` | `index.js:1938` |
| ✅ | `GET` | `/getWithdrawData` | `index.js:4793` |
| ✅ | `GET` | `/getWithdrawDataUser` | `index.js:4738` |
| ⬜ | `POST` | `/history` | `vaultpro/routes.js:12` |
| ⬜ | `GET` | `/lock-options` | `vaultpro/routes.js:6` |
| ✅ | `POST` | `/p2p/create-order` | `peerTrade/routes.js:43` |
| ✅ | `POST` | `/p2p/create-sell-order` | `peerTrade/routes.js:47` |
| ✅ | `POST` | `/p2p/dispute` | `peerTrade/routes.js:61` |
| ✅ | `POST` | `/p2p/mark-paid/:orderId` | `peerTrade/routes.js:52` |
| ✅ | `GET` | `/p2p/offers` | `peerTrade/routes.js:41` |
| ✅ | `GET` | `/p2p/order/:orderId` | `peerTrade/routes.js:44` |
| ✅ | `GET` | `/p2p/orders/:userId` | `peerTrade/routes.js:45` |
| ✅ | `GET` | `/p2p/sell-orders/:userId` | `peerTrade/routes.js:42` |
| ✅ | `POST` | `/remotes/create-deposit` | `apay/routes.js:40` |
| ✅ | `POST` | `/remotes/create-withdrawal` | `apay/routes.js:95` |
| ✅ | `GET` | `/remotes/deposit-info` | `apay/routes.js:55` |
| ✅ | `POST` | `/remotes/webhook` | `apay/routes.js:78` |
| ✅ | `POST` | `/remotes/withdrawal-webhook` | `apay/routes.js:112` |
| ⬜ | `POST` | `/transactions` | `vaultpro/routes.js:13` |
| ✅ | `POST` | `/updateFiatWithdrawStatus` | `fiatwithdraw/routes.js:7` |
| ✅ | `POST` | `/updateWithdrawStatus` | `index.js:4514` |
| ✅ | `GET` | `/user/crypto/deposits/:userId` | `depositHistory/routesusers.js:6` |
| ✅ | `GET` | `/user/crypto/stats/:userId` | `depositHistory/routesusers.js:102` |
| ✅ | `GET` | `/user/fiat/deposits/:userId` | `depositHistory/routesusers.js:130` |
| ✅ | `GET` | `/user/fiat/stats/:userId` | `depositHistory/routesusers.js:225` |
| ✅ | `GET` | `/user/withdrawals/:userId` | `withdrawHistory/routeshistory.js:6` |
| ✅ | `GET` | `/user/withdrawals/stats/:userId` | `withdrawHistory/routeshistory.js:103` |
| ✅ | `POST` | `/vault-data` | `index.js:3750` |
| ✅ | `GET` | `/withdrawals` | `index.js:5002` |

### rewards

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `GET` | `/Adminbonus/api/admin/bonuses` | `bonus/adminBonusRoutes.js:10` |
| ✅ | `POST` | `/affiliate/claim-reward` | `affiliate/affiliateroutes.js:87` |
| ✅ | `POST` | `/affiliate/claim-reward-all` | `affiliate/affiliateroutes.js:97` |
| ✅ | `POST` | `/affiliate/process-wager` | `affiliate/affiliateroutes.js:63` |
| ✅ | `GET` | `/affiliate/referral-info/:userId` | `affiliate/affiliateroutes.js:8` |
| ✅ | `GET` | `/affiliate/rewards/:referralCode` | `affiliate/affiliateroutes.js:52` |
| ✅ | `POST` | `/affiliate/rewards/record` | `affiliate/affiliateroutes.js:41` |
| ✅ | `GET` | `/affiliate/team/:referralCode` | `affiliate/affiliateroutes.js:19` |
| ✅ | `POST` | `/affiliate/team/add` | `affiliate/affiliateroutes.js:30` |
| ✅ | `GET` | `/affiliate/unclaimed-rewards/:uid` | `affiliate/affiliateroutes.js:76` |
| ✅ | `GET` | `/affiliateAdmin/dashboard-stats` | `affiliate/teamaffiliateroutes.js:11` |
| ✅ | `GET` | `/affiliateAdmin/rewards-list` | `affiliate/teamaffiliateroutes.js:14` |
| ✅ | `GET` | `/affiliateAdmin/settings` | `affiliate/teamaffiliateroutes.js:12` |
| ✅ | `PUT` | `/affiliateAdmin/settings` | `affiliate/teamaffiliateroutes.js:13` |
| ✅ | `GET` | `/affiliateAdmin/teams` | `affiliate/teamaffiliateroutes.js:6` |
| ✅ | `GET` | `/affiliateAdmin/teams/:teamId/members` | `affiliate/teamaffiliateroutes.js:7` |
| ✅ | `GET` | `/affiliateAdmin/top-affiliates` | `affiliate/teamaffiliateroutes.js:15` |
| ✅ | `GET` | `/affiliateAdmin/users-with-teams` | `affiliate/teamaffiliateroutes.js:8` |
| ✅ | `GET` | `/api/rewards/:uid` | `index.js:3934` |
| ✅ | `GET` | `/api/spinwin/admin/claims` | `spinwin/routes.js:9` |
| ✅ | `GET` | `/api/spinwin/admin/config` | `spinwin/routes.js:7` |
| ✅ | `PUT` | `/api/spinwin/admin/config` | `spinwin/routes.js:8` |
| ✅ | `GET` | `/api/spinwin/admin/slices` | `spinwin/routes.js:12` |
| ✅ | `POST` | `/api/spinwin/admin/slices` | `spinwin/routes.js:13` |
| ✅ | `PUT` | `/api/spinwin/admin/slices-bulk` | `spinwin/routes.js:14` |
| ✅ | `PUT` | `/api/spinwin/admin/slices/:id` | `spinwin/routes.js:15` |
| ✅ | `DELETE` | `/api/spinwin/admin/slices/:id` | `spinwin/routes.js:16` |
| ✅ | `GET` | `/api/spinwin/slices` | `spinwin/routes.js:19` |
| ✅ | `POST` | `/api/spinwin/user/claim` | `spinwin/routes.js:23` |
| ✅ | `GET` | `/api/spinwin/user/eligibility` | `spinwin/routes.js:22` |
| ✅ | `GET` | `/bonus/admin/bonusgame` | `bonus/routes.js:30` |
| ✅ | `GET` | `/bonus/admin/bonushistory` | `bonus/routes.js:31` |
| ✅ | `GET` | `/bonus/admin/userbonus` | `bonus/routes.js:29` |
| ✅ | `POST` | `/bonus/bonusgame` | `bonus/routes.js:9` |
| ✅ | `PUT` | `/bonus/bonusgame` | `bonus/routes.js:15` |
| ✅ | `DELETE` | `/bonus/bonusgame` | `bonus/routes.js:18` |
| ✅ | `POST` | `/bonus/bonushistory` | `bonus/routes.js:10` |
| ✅ | `PUT` | `/bonus/bonushistory` | `bonus/routes.js:16` |
| ✅ | `DELETE` | `/bonus/bonushistory` | `bonus/routes.js:19` |
| ✅ | `POST` | `/bonus/createbonusgame` | `bonus/routes.js:12` |
| ✅ | `POST` | `/bonus/createbonushistory` | `bonus/routes.js:13` |
| ✅ | `POST` | `/bonus/createuserbonus` | `bonus/routes.js:11` |
| ✅ | `GET` | `/bonus/redeem-bonus` | `bonus/routes.js:23` |
| ✅ | `POST` | `/bonus/redeem-bonus/create` | `bonus/routes.js:33` |
| ✅ | `POST` | `/bonus/redeem-bonus/redeem` | `bonus/routes.js:21` |
| ✅ | `POST` | `/bonus/user` | `bonus/routes.js:24` |
| ✅ | `POST` | `/bonus/userbonus` | `bonus/routes.js:8` |
| ✅ | `PUT` | `/bonus/userbonus` | `bonus/routes.js:14` |
| ✅ | `DELETE` | `/bonus/userbonus` | `bonus/routes.js:17` |
| ✅ | `GET` | `/bonus/users` | `bonus/routes.js:26` |
| ✅ | `GET` | `/clubbanner/clubs/:clubId/banner-notifications` | `clubmembership/clubbanners/routes.js:273` |
| ✅ | `POST` | `/clubbanner/clubs/:clubId/banners` | `clubmembership/clubbanners/routes.js:112` |
| ✅ | `GET` | `/clubbanner/clubs/:clubId/banners` | `clubmembership/clubbanners/routes.js:203` |
| ✅ | `PUT` | `/clubbanner/clubs/:clubId/banners/:bannerId` | `clubmembership/clubbanners/routes.js:146` |
| ✅ | `DELETE` | `/clubbanner/clubs/:clubId/banners/:bannerId` | `clubmembership/clubbanners/routes.js:178` |
| ✅ | `POST` | `/clubbanner/clubs/:clubId/banners/:bannerId/notify` | `clubmembership/clubbanners/routes.js:240` |
| ✅ | `GET` | `/clubbanner/clubs/banner-image/:imagePath(*)` | `clubmembership/clubbanners/routes.js:76` |
| ✅ | `PUT` | `/clubbanner/clubs/banner-notifications/:notificationId/read` | `clubmembership/clubbanners/routes.js:323` |
| ✅ | `DELETE` | `/clubmembership/:clubId/delete` | `clubmembership/routes.js:10` |
| ✅ | `GET` | `/clubmembership/:clubId/hierarchy` | `clubmembership/routes.js:16` |
| ✅ | `GET` | `/clubmembership/:tableName/fetch` | `clubmembership/routes.js:11` |
| ✅ | `POST` | `/clubmembership/change-role` | `clubmembership/routes.js:13` |
| ✅ | `POST` | `/clubmembership/create` | `clubmembership/routes.js:8` |
| ✅ | `PUT` | `/clubmembership/earnings-config` | `clubmembership/routes.js:21` |
| ✅ | `POST` | `/clubmembership/join` | `clubmembership/routes.js:12` |
| ✅ | `GET` | `/clubmembership/profile/:clubId` | `clubmembership/routes.js:14` |
| ✅ | `PUT` | `/clubmembership/update` | `clubmembership/routes.js:9` |
| ✅ | `GET` | `/clubmembership/user-affiliations/:userId` | `clubmembership/routes.js:17` |
| ✅ | `GET` | `/clubmembership/userprofile/:userId` | `clubmembership/routes.js:15` |
| ✅ | `POST` | `/clubnotification/clubs/:clubId/notifications` | `clubmembership/clubnotification/routes.js:45` |
| ✅ | `GET` | `/clubnotification/clubs/:clubId/notifications` | `clubmembership/clubnotification/routes.js:69` |
| ✅ | `PUT` | `/clubnotification/clubs/notifications/:notificationId/read` | `clubmembership/clubnotification/routes.js:88` |
| ✅ | `GET` | `/get-referral-code/:uid` | `index.js:3792` |
| ✅ | `GET` | `/get-referral-link/:uid` | `index.js:3838` |
| ✅ | `POST` | `/giftCard/activate` | `GiftCards/router.js:16` |
| ✅ | `GET` | `/giftCard/admin/analytics` | `GiftCards/router.js:29` |
| ✅ | `POST` | `/giftCard/admin/create` | `GiftCards/router.js:6` |
| ✅ | `DELETE` | `/giftCard/admin/delete/:id` | `GiftCards/router.js:12` |
| ✅ | `GET` | `/giftCard/admin/list` | `GiftCards/router.js:9` |
| ✅ | `GET` | `/giftCard/admin/records` | `GiftCards/router.js:32` |
| ✅ | `POST` | `/giftCard/claim` | `GiftCards/router.js:23` |
| ✅ | `POST` | `/giftCard/search` | `GiftCards/router.js:13` |
| ✅ | `GET` | `/giftCard/user/:userId/active-with-status` | `GiftCards/router.js:18` |
| ✅ | `GET` | `/giftCard/user/:userId/claimed` | `GiftCards/router.js:26` |
| ✅ | `GET` | `/Userbonus/api/bonus-history` | `bonus/userBonusRoutes.js:145` |
| ✅ | `GET` | `/Userbonus/api/bonuses` | `bonus/userBonusRoutes.js:82` |
| ✅ | `POST` | `/Userbonus/api/bonuses/claim/:type` | `bonus/userBonusRoutes.js:174` |
| ✅ | `GET` | `/Userbonus/debug-bonus/:userId` | `bonus/userBonusRoutes.js:242` |
| ✅ | `GET` | `/verify-referral-code/:referralCode` | `index.js:3855` |

### wallet

| | Method | Path | Legacy source |
|---|---|---|---|
| ✅ | `GET` | `/exchangeRate/convert` | `exchangerate/routes.js:7` |
| ✅ | `GET` | `/exchangeRate/convert/:from/:to/:amount` | `exchangerate/routes.js:8` |
| ✅ | `GET` | `/exchangeRate/rates` | `exchangerate/routes.js:11` |
| ✅ | `POST` | `/exchangeRate/rates` | `exchangerate/routes.js:17` |
| ✅ | `GET` | `/exchangeRate/rates/:currency` | `exchangerate/routes.js:14` |
| ✅ | `PUT` | `/exchangeRate/rates/:currency` | `exchangerate/routes.js:20` |
| ✅ | `DELETE` | `/exchangeRate/rates/:currency` | `exchangerate/routes.js:23` |
| ✅ | `GET` | `/getAllChains` | `index.js:2070` |
| ✅ | `POST` | `/getCoinDetails` | `index.js:2046` |
| ✅ | `GET` | `/getwallet` | `index.js:4168` |
| ✅ | `POST` | `/inrhistory` | `index.js:6127` |
| ✅ | `GET` | `/internalswap/balances/:uid` | `internalswap/routes.js:8` |
| ✅ | `GET` | `/internalswap/estimate` | `internalswap/routes.js:11` |
| ✅ | `GET` | `/internalswap/history` | `internalswap/routes.js:17` |
| ✅ | `GET` | `/internalswap/history/:uid` | `internalswap/routes.js:20` |
| ✅ | `POST` | `/internalswap/swap` | `internalswap/routes.js:14` |
| ✅ | `GET` | `/rate` | `index.js:6170` |
| ✅ | `POST` | `/transfer-in` | `index.js:3631` |
| ✅ | `POST` | `/transfer-out` | `index.js:3700` |
| ✅ | `POST` | `/updatebalance` | `index.js:4331` |
| ✅ | `GET` | `/wallethistory/:uid` | `index.js:4421` |
| ⬜ | `GET` | `/walletNotify` | `index.js:6146` |

<!-- END GENERATED -->

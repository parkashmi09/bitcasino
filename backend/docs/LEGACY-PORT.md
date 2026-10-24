# Legacy port — process and status

Porting `legacy/` (591 route declarations, **558 unique**, 1,602 raw SQL calls)
into the microservices, converting every query to Sequelize while keeping the
old paths working.

```bash
node tools/route-inventory.js            # regenerate manifest + checklist
node tools/route-inventory.js --report   # progress only
```

Current status is in [ROUTE-PORT-CHECKLIST.md](ROUTE-PORT-CHECKLIST.md).

Related:

- [API-ROUTES.md](API-ROUTES.md) — every live route, plus the full legacy inventory.
- [BETTING-LOGIC.md](BETTING-LOGIC.md) — how money moves: bet placement, the
  exposure book, settlement, and **which parts of the legacy sports maths are
  not ported yet**.

---

## How a route counts as ported

A handler must carry a `@legacy` tag naming the route it replaces:

```js
/** @legacy POST /updatebalance */
async updateBalance(req, res) { … }
```

`tools/route-inventory.js` reads those tags out of the new services and diffs
them against what it finds in `legacy/`. **The checklist cannot be marked
complete by editing it** — only by shipping a handler that claims the route.
That is deliberate: the failure mode in a port this size is a route quietly
disappearing, and nobody noticing until a player does.

---

## The four-step pattern

Worked example: `POST /updatebalance` (`legacy/index.js:4331`) →
[services/user/src/modules/wallet-admin/](../services/user/src/modules/wallet-admin/).

**1. Repository** — every query for the table, converted to Sequelize.
Raw SQL survives only where it earns its place: `FOR UPDATE` row locks and
`SET col = col + :delta`, which Sequelize cannot express without a
read-modify-write round trip.

**2. Service** — the business rules, in the legacy validation *order*. The admin
UI branches on which error returns first, so `coin → operation → amount →
password → direct-user → apply` is preserved exactly.

**3. Routes** — mounted on a clean path (`/wallet/admin/balance`) with the
`@legacy` tag.

**4. Gateway compat** — [gateway/src/legacyRoutes.js](../gateway/src/legacyRoutes.js)
maps the old path onto the new one, so both work:

```
POST /updatebalance                    ← legacy clients, provider callbacks
POST /api/v1/wallet/admin/balance      ← new clients
```

This matters most for provider callbacks (`/api/seamless/*`,
`/api/ccpaymentnotify`): those paths are registered on the **provider's** side
and cannot be changed without a support ticket.

---

## Response shape

Ported routes return the legacy body verbatim where a client parses it.
`GET /wallethistory/:uid` still returns `{ history, count }`, not the platform
envelope. Fields may be *added* — `/updatebalance` now returns
`previousBalance`/`newBalance` so the admin UI need not re-fetch — but nothing
is renamed or removed.

---

## Bugs found while porting

Behaviour is preserved except where the legacy behaviour was wrong. Each of
these is a deliberate, documented change.

### `/updatebalance` — the transaction was not a transaction

```js
await pg.query('BEGIN');          // on the SHARED client
await pg.query(updateQuery, …);
await pg.query('COMMIT');
```

`legacy/General/Model/pool.js` warns about exactly this in its own header:

> Running BEGIN/COMMIT on it is not concurrency-safe — one request's
> transaction would wrap another request's queries on the same connection.

A concurrent request could be committed or rolled back by an unrelated one.
Now uses a real pooled transaction.

### `/updatebalance` — audit trail could record numbers that never existed

`getCurrentBalance()` read the balance, then `UPDATE … SET coin = coin + $1`
wrote it, with nothing holding the row in between. The UPDATE was atomic so the
*balance* survived, but `previous_balance` / `new_balance` in `wallet_history`
were computed from the stale read. Now read under `SELECT … FOR UPDATE`.

### `/updatebalance` — debit could go negative

```js
const newBalance = Math.max(0, previousBalance - parseFloat(amount));
```

The clamp applied to the number written to *history*; the column itself was
decremented unclamped. History said `0`, the balance said `-50`. The debit is
now rejected with `Insufficient balance for this debit`.

**This is the one intentional behaviour change a caller can observe** — a debit
larger than the balance used to "succeed".

### `/wallethistory/:uid` and `/adminwalletadd` — no authentication

Neither had any auth in `legacy/index.js`. Anyone who could reach the server
could read any player's full wallet history, or top up the platform INR float.
Both are staff-only now.

### `/wallethistory/:uid` — unbounded `limit`

`limit` went straight from the query string into the SQL. `?limit=999999999`
was a full table scan any anonymous caller could trigger. Capped at 500.

### Coin interpolated into SQL

```js
const query = `SELECT ${coin} FROM credits WHERE uid = $1`;
UPDATE credits SET ${coin} = ${coin} + $1 WHERE uid = $2
```

`coin` came from `req.body`. It *was* guarded by `WALLET_COINS.includes(coin)`
at the route — so not exploitable in practice — but the guard and the
interpolation were in different files, and nothing forced the next caller to
repeat it. The allowlist now lives in the repository beside the interpolation,
derived from the real `credits` columns rather than a hand-maintained constant
that had already drifted.

---

## Ownership boundaries

`user-service` verifies staff tokens for the ported staff routes and reads
`staff.transaction_password`, but does **not** load the `admin` model domain.
That read is a parameterised SQL query, not `models.Staff`, so the boundary
stays visible and a later change cannot casually start writing staff rows from
the wrong service.

---

## Remaining work

**554 of 558 routes**, all of them working in `legacy/` right now. This is a
migration backlog, not a defect list. Largest groups:

| Service | Module | Routes | Notes |
|---|---|---|---|
| admin | management | 100 | Reports, config, staff, banners |
| sports | betting | 99 | `sportsapi/` alone is 64 |
| user | rewards | 89 | Bonus, affiliate, club, gift cards |
| user | payments | 89 | Deposits, withdrawals, PSPs |
| casino | games | 88 | `gis/` provider integration is 49 |
| user | accounts | 29 | Profile, KYC, 2FA, OTP |
| user | wallet | 20 | Swap, exchange rate |
| casino | provider-callbacks | 14 | **Paths fixed by the provider** |
| casino | bets | 10 | |
| admin | notifications | 7 | |
| user | payment-callbacks | 5 | **Paths fixed by the provider** |
| platform | infrastructure | 4 | Static, health, uploads |

Suggested order, highest risk first:

1. **provider-callbacks (19)** — money in and out, and the paths cannot change.
   Port these before anything reroutes traffic at the edge.
2. **user/payments (89)** — deposits and withdrawals.
3. **user/accounts (29)** — small, and unblocks the rest of the user surface.
4. **casino/games + bets (98)**, **sports/betting (99)** — both settle money and
   must go through the wallet API, never `UPDATE credits`.
5. **admin/management (100)** — mostly reads; safest, so leave it last.

Expect more findings like the ones above: 1,602 raw `.query()` calls were
written against a shared client with no locking discipline, and the balance
paths are where that matters.

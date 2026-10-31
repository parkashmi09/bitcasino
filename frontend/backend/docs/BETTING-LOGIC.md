# Betting logic — how money actually moves

Written because the maths is spread across services and none of it is obvious
from reading one file. This is the map: what happens on a bet, how exposure is
calculated, how settlement pays out, and **which parts of your original logic are
not ported yet**.

**Read this section first if you are looking for the exposure calculation:**
[§5 — the legacy exposure model](#5-the-legacy-exposure-model-per-outcome-book).
It is not a scalar. The new sports service currently implements a simpler model
and §6 says exactly where they differ.

**Contents**

1. [The one rule](#1-the-one-rule)
2. [The money primitive](#2-the-money-primitive-applymovement)
3. [Casino bet lifecycle](#3-casino-bet-lifecycle)
4. [Sports bet lifecycle (new service)](#4-sports-bet-lifecycle-new-service)
5. [The legacy exposure model](#5-the-legacy-exposure-model-per-outcome-book)
6. [Gap: legacy vs new](#6-gap-legacy-vs-new)
7. [Settlement](#7-settlement)
8. [Failure modes and why the order is what it is](#8-failure-modes)
9. [Where each piece lives](#9-where-each-piece-lives)

---

## 1. The one rule

**Only user-service writes a balance.** Casino and sports never run
`UPDATE credits`. They call `POST /internal/wallet/debit` and
`/internal/wallet/credit`.

That is not architectural purity — it is what makes the ledger complete. One
code path writes balances, and it writes a `user_ledger` row in the same
transaction, every time. So this always holds:

```
credits.<currency>  ==  SUM(user_ledger.amount) for that user + currency
```

`GET /internal/wallet/:userId/reconcile` checks it. If it ever fails, money
moved outside the primitive, and that is a bug worth stopping for.

---

## 2. The money primitive — `applyMovement`

[services/user/src/modules/wallet/wallet.service.js](../services/user/src/modules/wallet/wallet.service.js)

Everything — bets, payouts, refunds, transfers, admin credits, withdrawals — is
a wrapper around this one function. It runs five steps, **in this order**, inside
one transaction:

```
1. idempotency check   →  already applied? return the original, move nothing
2. SELECT … FOR UPDATE →  lock the row, THEN read the balance
3. guard               →  debit larger than the balance? reject
4. UPDATE credits      →  SET col = col + :delta, with the guard repeated in SQL
5. INSERT user_ledger  →  same transaction, always
```

### Why the lock comes before the read

Without it, two concurrent bets both read a balance of 100, both decide 60 is
affordable, and both write. You end with −20 and two ledger rows that each claim
to be valid.

```
   NO LOCK                          WITH LOCK
   A reads 100                      A locks, reads 100
   B reads 100                      B blocks…
   A writes 40                      A writes 40, commits, releases
   B writes 40   ← wrong            B reads 40, rejects 60  ← correct
```

Verified: 10 simultaneous debits of 20 against a balance of 100 → **exactly 5
succeed, 5 rejected, final balance exactly 0.00000000**.

### Why the idempotency key is not optional

Casino and sports call user-service over HTTP. HTTP times out. The caller
retries. Without a key, the retry is a *second* payout.

```jsonc
{ "idempotencyKey": "casino:dice:9f2c4a…:payout" }
```

A replay returns `{"replayed": true, "ledgerId": <the original id>}` and moves
nothing. The key is derived from the **round**, not from a timestamp or a random
value — a key that changes on retry is the same as having no key.

### Money is never a JS float

`0.1 + 0.2 === 0.30000000000000004`. Balances would drift. All arithmetic goes
through [packages/common/src/money.js](../packages/common/src/money.js), which
works in BigInt minor units at 8 decimal places and only converts to a decimal
string at the boundary.

### Deadlocks

Player-to-player transfers lock **two** rows. A→B and B→A at the same instant
would each hold the lock the other needs, and Postgres kills one. So the rows
are always locked in a fixed order — lowest user id first:

```js
const [firstId, secondId] = [fromUserId, recipient.id].sort((a, b) => a - b);
```

Same reasoning behind `lockRowsInOrder` in
[packages/db/src/transaction.js](../packages/db/src/transaction.js).

---

## 3. Casino bet lifecycle

[services/casino/src/modules/bets/bets.service.js](../services/casino/src/modules/bets/bets.service.js)

A casino round resolves immediately. Five steps:

```
1. validate      stake limits, game known, player may bet
2. DEBIT         money leaves FIRST                      ← user-service
3. resolve       provably-fair outcome from the hash
4. record        INSERT into bets
5. CREDIT        only if it won                          ← user-service
```

### Why debit before resolve

If the process dies between the debit and the payout, the player is short a
stake and the ledger says exactly why — recoverable, visible. Resolve first and
debit after, and a crash produces a **winning round that was never paid for**.
Between the two, choose the failure you can find in a report.

### Payout maths

```
payout     = stake × multiplier      (0 if lost)
profit     = payout − stake          (negative on a loss — this is what `bets.profit` stores)
```

Dice, `target=50`, `direction=over`, house edge 2%:

```
winChance  = 100 − 50            = 50 %
multiplier = (100 − 2) / 50      = 1.96
stake 10.00 → win  → payout 19.60, profit +9.60
             → lose → payout  0.00, profit −10.00
```

Coinflip: `multiplier = 2 × (1 − edge/100) = 1.96`.
Crash / limbo: the player names `cashoutAt`; they win if `crashAt >= cashoutAt`,
and the multiplier is their own `cashoutAt`.

### Provably fair

```
serverSeed      random 32 bytes, kept secret while in use
serverSeedHash  SHA-256(serverSeed) — published BEFORE any bet
clientSeed      the player's, changeable at any time
nonce           increments once per round
roundHash       HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)
```

The outcome is derived from `roundHash` alone. The player has the hash up front
and the seed after rotation, so every past round is checkable and no future one
is predictable. That is the whole point of revealing **only** on rotation.

The nonce increments with `UPDATE … SET fair_nonce = fair_nonce + 1 RETURNING`
in a single statement. Two concurrent bets must never get the same nonce — they
would produce the same hash, and the unique index on `bets.hash` would reject the
second.

### The refund path

Steps 3–5 are wrapped in `try/catch`. Anything that throws after the debit calls
`refundStake()` before the error propagates — the stake is already gone, and a
failed insert must not silently keep it.

If the refund **itself** fails there is nothing left to try in-process, so it is
logged at `fatal` with everything needed to reconcile by hand:

```
STAKE NOT REFUNDED — player was debited for a bet that never completed.
```

Swallowing that would turn a visible inconsistency into a silent one.

---

## 4. Sports bet lifecycle (new service)

[services/sports/src/modules/bets/sports.service.js](../services/sports/src/modules/bets/sports.service.js)

A sports bet does **not** resolve immediately, which changes two things:

1. The stake is debited at placement; the payout may be days later.
2. Open bets create **liability**. A player with ₹10 holding ten open ₹10 bets at
   10× could win ₹1,000 the house must cover. So exposure is tracked and checked
   on every placement.

```
1. validate       stake limits, odds 1.01–1000, betType back|lay
2. compute        liability, potentialPayout
3. check exposure against the player's limit
4. DEBIT          the stake                              ← user-service
5. transaction    { addExposure ; INSERT SportsBet }     ← atomic
6. on failure     refund the stake
```

The exposure row and the bet row are written in **one** transaction. Writing the
bet without its exposure would understate what the house owes.

### Current formulas

```
liability        = stake × (odds − 1)
potentialPayout  = stake × odds
```

Exposure is accumulated per match with a single atomic statement — never
read-modify-write, which would let two simultaneous bets each see the old
exposure and both pass a limit check they should jointly have failed:

```sql
INSERT INTO user_exposures (…) VALUES (…)
ON CONFLICT (user_id, match_id)
DO UPDATE SET exposure_amount = user_exposures.exposure_amount + EXCLUDED.exposure_amount
RETURNING exposure_amount
```

The limit check: `current + additional > limit` → `403`. **A limit of 0 means
unlimited**, matching how the platform stored it — an unset limit must not
silently block every bet.

---

## 5. The legacy exposure model (per-outcome book)

**This is the logic you were looking for.**
[legacy/sportsbet/sportbetscontroller.js:40–312](../legacy/sportsbet/sportbetscontroller.js#L40-L312)

Legacy does **not** track one number per match. It tracks a **vector — one
signed exposure per outcome** — and blocks only the worst case. That is the
correct model for an exchange-style book, and it is materially different from
what the new service does today.

### The data structure

`user_exposures` keyed on `(user_id, match_id, team_name)`. For a three-way
cricket market a player's book might be:

```
{ "India": +150.00, "Australia": -80.00, "The Draw": -80.00 }
```

Read it as: *if India wins I gain 150; if either other result lands I lose 80.*

### How a bet updates the vector

`stake = S`, decimal odds `O`, `profit = S × (O − 1)`, `layLiability = S × (O − 1)`.

**Match Odds (`MO`), back on a team:**

| Outcome | Change |
|---|---|
| the selection | `+profit` |
| the other team | `−stake` |
| `The Draw` *(only when `count == 3`)* | `−stake` |

**MO, lay on a team:**

| Outcome | Change |
|---|---|
| the selection | `−layLiability` |
| the other team | `+stake` |
| `The Draw` *(only when `count == 3`)* | `+stake` |

**MO, back on the Draw:** `The Draw +profit`, both teams `−stake`.
**MO, lay on the Draw:** `The Draw −layLiability`, both teams `+stake`.

`count` is the number of runners in the market. `count == 3` gates every
`The Draw` write, so a two-way market never grows a phantom third outcome.

**Bookmaker (`BM`)** — identical shape, two-way only, **but the odds are
normalised first**:

```js
normalizeOdds(odds):
  odds > 100  →  odds/100 + 1      // 150  → 2.50   (American-style)
  odds < 100  →  1 + odds/100      // 2.75 → 1.0275, 50 → 1.50
  odds == 100 →  2.0
  then floor to 2 decimals (never round up — the house does not round in the player's favour)
```

Every BM profit/liability figure uses `newodds`, not the raw input. **The new
service does not do this at all** — it takes decimal odds only.

**Fancy (`FAN`, and `MO` with a yes/no bet type)** — exposure updates are
**disabled** (`[FANCY] Bet disabled for exposer`). The stake is simply blocked:
`balanceChange = stake`.

### How much is actually deducted — the max-liability delta

This is the part that has no equivalent in the new service. Legacy blocks the
**worst case across the whole book**, not the sum of bets:

```js
oldMax = |min(negative values in oldExposures)|   // 0 if none
newMax = |min(negative values in newExposures)|   // 0 if none
liabInc = newMax − oldMax

if (first bet on this match)  balanceChange = newMax
else if (liabInc > 0)         balanceChange = liabInc     // deduct the increase
else if (liabInc < 0)         balanceChange = liabInc     // NEGATIVE → releases funds back
```

Then, once:

```sql
UPDATE credits SET inr = inr - $balanceChange WHERE uid = $1
```

**A hedge can pay you back mid-match.** Bet the other side and your worst case
shrinks, so `liabInc` is negative and the `UPDATE` adds funds to the wallet. A
model that only ever deducts `stake × (odds − 1)` per bet cannot do this — it
over-blocks a hedged book, sometimes by a lot.

### Worked example

Two-way market, India vs Australia. Wallet ₹1,000.

**Bet 1 — back India, stake 100 @ 2.50.** `profit = 150`.

```
book:   { India: +150, Australia: −100 }
oldMax = 0, newMax = 100, first bet → block 100
wallet: 1000 → 900
```

**Bet 2 — back Australia, stake 100 @ 3.00.** `profit = 200`.

```
book:   { India: +150 − 100 = +50, Australia: −100 + 200 = +100 }
newMax = 0  (no negatives left — the book is green either way)
liabInc = 0 − 100 = −100  →  RELEASE 100
wallet: 900 → 1000
```

The player now wins whatever happens, and legacy correctly holds nothing. The
current new-service formula would have blocked `100×1.5 + 100×2 = 350` and
released none of it.

### What gets stored on the bet row

```js
liability          = back ? stake : stake × (odds − 1)     // MO
                   = back ? stake : stake × (newodds − 1)  // BM, normalised
                   = stake                                 // FAN
exposure_after_bet = max(0, |most negative exposure|)
```

---

## 6. Gap: legacy vs new

Honest status. The new sports service is a **correct simple model**, not your
model.

| Concern | legacy | new service | Ported? |
|---|---|---|---|
| Exposure shape | vector, one signed row per outcome | one scalar per match | ❌ |
| Amount blocked | max-liability **delta** | `stake × (odds − 1)` per bet | ❌ |
| Hedging releases funds | yes, `liabInc < 0` refunds | no | ❌ |
| `BM` odds normalisation | `normalizeOdds()` | none | ❌ |
| `FAN` / fancy markets | fixed stake block, exposure off | not implemented | ❌ |
| Three-way `count == 3` draw handling | yes | no draw concept | ❌ |
| Parent-staff lock check | walks `staff_hierarchy` | own account only | ❌ |
| `usd_amount` FX conversion | live rate, 5-min cache, fallback 83 | not implemented | ❌ |
| Row locking | `FOR UPDATE` on exposures ✅ | ✅ | ✅ |
| Real transaction | ❌ `BEGIN` on the **shared** client | ✅ pooled | fixed |
| Balance guard | ✅ checks before deducting | ✅ | ✅ |
| Idempotency | ❌ none | ✅ | improved |

Two things worth knowing about the legacy code as it stands:

- **`db.query('BEGIN')` runs on the shared client.** `legacy/General/Model/pool.js`
  warns about this in its own header. One request's `COMMIT` can commit another
  request's half-finished work. The exposure `FOR UPDATE` gives less protection
  than it looks like it does.
- **The wallet `UPDATE` has no guard.** `currentInr < balanceChange` is checked
  against a value read *before* the exposure lock, and the `UPDATE` itself has no
  `WHERE inr >= …`. Two bets placed together can both pass and drive the balance
  negative.

Porting §5 faithfully — while keeping the pooled transaction, the guard and the
idempotency key — is the single highest-value piece of remaining work in
`sports/betting`.

---

## 7. Settlement

### New service

[sports.service.js `settleMatch()`](../services/sports/src/modules/bets/sports.service.js)

```
advisory lock on `sports-settle:<matchId>`
  ├ SELECT pending bets FOR UPDATE
  ├ classify each: void | won | lost
  ├ UPDATE status
  └ DELETE exposures for the match
COMMIT
  └ then pay out, one credit call per winner
```

`back` wins when its selection won; `lay` wins when it did **not** — one line
covers both:

```js
winners.has(selection) === (bet.bet_type === 'back')
```

Payouts:

```
void → stake back, nothing more
back → stake × odds
lay  → stake + liability
```

**The advisory lock is what stops double payment.** If an operator and the cron
fire at once, the second call returns `409 CONFLICT` instead of paying every
winner twice. The lock releases on commit, so a crashed worker does not block
settlement forever.

**Payouts run after the commit, deliberately.** Holding a transaction open across
N HTTP calls would pin a connection and a row lock for the whole run — thousands
of calls on a popular match. Committing first means the bets are marked settled
and each payout is independently retryable by its idempotency key
(`sports-settle:<matchId>:<betId>`). Failures come back as `failedPayouts`;
re-running settlement retries only those, because the rest are no longer pending
and their keys make the successful credits no-ops.

Verified: settle → 300 becomes 500. Re-settle → still 500, exactly one `bet_won`
ledger row.

### Legacy settlement — `calculateFinalCredit`

[legacy/sportsmain/cron/settlement.js:1057](../legacy/sportsmain/cron/settlement.js#L1057)

Legacy does not pay per bet. It pays **once per match, from the exposure book**,
which is the correct counterpart to blocking the max liability:

```js
mostNeg        = min(exposures)            // the amount that was blocked
winnerExposure = exposures[winnerName]

refund            → credit |mostNeg|                      // give the block back
all positive      → credit winnerExposure
winnerExposure<0  → credit |mostNeg| − |winnerExposure|
otherwise         → credit |mostNeg| + winnerExposure
```

Then exposures for the match are deleted and the bets closed.

Winner-name matching is fuzzy on purpose — exact, then `startsWith`, then
`contains`, ignoring case and whitespace. Feed results arrive as `'The Draw '`
with a trailing space while the exposure key is `'The Draw'`. No match returns
`SUSPENDED` rather than silently crediting zero.

There is a `Number.isFinite` guard before every credit: a missing exposure used
to produce `credit = NaN`, and one `NaN` propagating into `users.total_profit`
breaks the whole ledger total.

**None of this is ported.** The new `settleMatch` is per-bet and cannot be
switched on for real markets until §5 lands, because the two models must agree
about what was blocked at placement.

---

## 8. Failure modes

Every ordering choice above answers "what breaks if the process dies here?"

| Crash point | Result | Recovery |
|---|---|---|
| before the debit | nothing happened | none needed |
| after debit, before resolve | stake gone, no bet | `refundStake()` on the way out |
| after resolve, before insert | stake gone, no bet | `refundStake()` |
| after insert, before payout | bet recorded, unpaid | replay the round — the key makes the debit a no-op, the credit lands |
| refund itself fails | stake gone, no bet, no refund | `fatal` log line with every field needed to fix by hand |
| mid-settlement | some bets settled, some not | re-run; settled bets are no longer pending, keys deduplicate the credits |
| two settlements at once | — | the advisory lock rejects the second with `409` |

The pattern throughout: **prefer a visible inconsistency over a silent one.** A
`fatal` log with the user id, currency, amount and round key is fixable. A
swallowed error is not.

---

## 9. Where each piece lives

| Concern | File |
|---|---|
| Money arithmetic (BigInt) | [packages/common/src/money.js](../packages/common/src/money.js) |
| Locks, retries, advisory locks | [packages/db/src/transaction.js](../packages/db/src/transaction.js) |
| Balance primitive | [services/user/src/modules/wallet/wallet.service.js](../services/user/src/modules/wallet/wallet.service.js) |
| Wide `credits` table access | [services/user/src/modules/wallet/wallet.repository.js](../services/user/src/modules/wallet/wallet.repository.js) |
| Casino round | [services/casino/src/modules/bets/bets.service.js](../services/casino/src/modules/bets/bets.service.js) |
| Dice / crash / hash | [services/casino/src/modules/bets/provablyFair.js](../services/casino/src/modules/bets/provablyFair.js) |
| Sports placement + settlement | [services/sports/src/modules/bets/sports.service.js](../services/sports/src/modules/bets/sports.service.js) |
| Exposure queries | [services/sports/src/modules/bets/sports.repository.js](../services/sports/src/modules/bets/sports.repository.js) |
| Settlement scheduling | [services/sports/src/workers/scheduler.js](../services/sports/src/workers/scheduler.js) |
| **Legacy exposure book** | [legacy/sportsbet/sportbetscontroller.js:40](../legacy/sportsbet/sportbetscontroller.js#L40) |
| **Legacy settlement credit** | [legacy/sportsmain/cron/settlement.js:1057](../legacy/sportsmain/cron/settlement.js#L1057) |

Routes: [API-ROUTES.md](API-ROUTES.md). Port status: [LEGACY-PORT.md](LEGACY-PORT.md).

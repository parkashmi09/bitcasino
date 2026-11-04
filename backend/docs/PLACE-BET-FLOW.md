# Sports Place Bet — How It Works

This document explains, in plain words, what happens on the backend when a player places a
sports bet (back / lay / yes / no) on the exchange.

All paths are relative to `bitcasino/backend/services/sports/src/` unless written otherwise.
Line numbers were correct when this was written (2026-11-03); they may drift as code changes.

---

## 1. The big picture

```
Player clicks "Place Bet"
        │
        ▼
POST /api/v1/sports/user/place
        │
        ▼
Middleware: refuseCustomCurrencies → sportsEnabled → authMiddleware
        │
        ▼
placeBetBuffered   (the "buffer": wait a few seconds, confirm the live price)
        │   rejected? → 400 with a reason code
        ▼
placeBet           (the "controller": checks, money, saving — one DB transaction)
        │   any error? → rollback → 400
        ▼
commit → pushBalance (socket) → JSON reply to the player
```

There are two main layers:

1. **The buffer** (`modules/bets/buffer/`) — protects the site from players betting on old
   odds. It waits a few seconds, watches the live odds feed, and only lets the bet through if
   the market is still open and the price is still good. It also replaces the odds / stake /
   runners the player sent with the server's own values.
2. **The controller** (`modules/bets/controllers/sportbetscontroller.mjs`) — does every
   business check (locks, limits, balance), works out the exposure, takes the money and saves
   the bet. Everything here runs inside **one database transaction**, so either everything is
   saved or nothing is.

---

## 2. The route and its middleware

**File:** `modules/bets/routes/public.routes.js`

```js
router.use(refuseCustomCurrencies('SPORTS'));                                   // line 38
router.post('/place', enabled, authMiddleware, lazy((m) => m.placeBetBuffered)); // line 41
```

The router is mounted at `/api/v1/sports/user`, so the full URL is
`POST /api/v1/sports/user/place`.

The request passes through these, in order:

### 2.1 `refuseCustomCurrencies('SPORTS')`
**Location:** `backend/packages/common/src/currencies.js:197`

Looks at `req.body`, `req.query` and `req.params` for any currency field. If the currency is a
**custom coin** (a coin an owner created, with no real provider behind it), the request is
refused with `CURRENCY_NOT_SUPPORTED_FOR_SPORTS`. Sports only accepts real currencies.

### 2.2 `enabled` → `sportsEnabled(deps)`
**Location:** `lib/sportsEnabled.js:53`

The on/off switch for sports on this site. It checks two things:
- **Is sports in the owner's plan?** (`entitlements.assertFlagEntitled('sports')`). If not, the
  request is refused.
- **Has the site admin switched sports on?** It asks admin-service
  (`GET /internal/admin/site-config/sports`) and caches the answer for a few seconds, so it does
  not ask on every request. If sports is off → `503 FEED_SPORTS_DISABLED`.

If admin-service cannot be reached, it **fails open** (lets the bet continue) so a short outage
does not take sports down.

### 2.3 `authMiddleware`
Checks the player's login token and puts the player on `req.user`. The player's ID is read later
as `req.user.account.id`.

### 2.4 `lazy(...)`
**Location:** `lib/mssports.js:29`

Only a loading helper. It loads the sports module the first time the route is hit, instead of at
start-up. It does not change how the bet works.

---

## 3. Layer 1 — The buffer

**File:** `modules/bets/buffer/betBuffer.mjs`

### 3.1 `placeBetBuffered(req, res)` — entry point
**Location:** `modules/bets/buffer/betBuffer.mjs:214`

This is the handler the route calls. Step by step:

1. **Hidden sports / leagues.** If the sport or league is one this site does not offer
   (Politics, E Games, Virtual Cricket …), reply `400 "This market is not available"`.
   Uses `isHiddenSport` / `isHiddenLeague` (`lib/constants/hiddenSports.mjs:14`, `:16`).
2. **Lone badlo bet.** A single badlo leg has no liability, so it is not allowed here. Badlo
   bets must go through `/place-combined`. Uses `isBadloLeg` (`lib/helper/badloMarket.mjs:16`).
3. **Read the buffer options.** The frontend sends extra info in `req.body.server_buffer`
   (selected odds, client ref, flags…). It is taken out of the body and kept as `sb`.
   For **line markets** (`isLineMarket`, `lib/helper/lineMarket.mjs:3`) some flags are forced.
4. **Decide if we wait.** `noWait` is true when there is no `server_buffer`, or when the env
   flag `SERVER_SIDE_BET_BUFFER=false`.
5. **Duplicate guard.** If the frontend sent a `client_ref`, `betInflight.begin()` is called:
   - same ref still running → `409 pending` (do not place it twice);
   - same ref already finished → return the old answer again with `duplicate: true`.
6. **Wrap `res.json`.** So that when the bet finishes, the result is stored in `betInflight`
   (for `getBetResult`) and the final odds / stake / `client_ref` are added to the reply.
7. **Run the buffer:** `decision = await runBetBuffer(req.body, sb, { noWait })`.
   - crash → `500 "Bet placement failed"`;
   - `decision.accept === false` → `400` with `decision.message` and `decision.code`.
8. **Apply the decision:** `applyDecision(req.body, decision)` — overwrite the body with the
   server's odds, stake and runners.
9. **Hand over:** `return placeBet(req, res)`.

### 3.2 `runBetBuffer(body, sb, opts)` — the price check
**Location:** `modules/bets/buffer/betBuffer.mjs:43`

This is the heart of the buffer. It returns either
`{ accept: true, odds, size, stake, runners, ... }` or `{ accept: false, message, code }`.

1. **Market reference needed.** If there is no event (`eventid`), sport (`sid`) or market
   (`match_id`) and fail-closed mode is on → reject `NO_MARKET_REF`.
2. **How long to wait.** `resolveBufferSeconds()` (see 3.3) — e.g. 5 seconds for live markets,
   3 seconds for fancy. `0` if `noWait`.
3. **Start watching odds.** `liveOdds.acquire(gmid, sid)` starts (or joins) a poller for this
   event.
4. **Wait loop.** Every 500 ms until the buffer time is over:
   - read the newest odds (`liveList`);
   - `readBufferTick()` checks the market and runner;
   - if the market / runner is **SUSPENDED / BALL RUNNING / INACTIVE** or has no odds →
     mark as `blocked` and stop waiting;
   - if live → remember the latest size (liquidity).
5. **Feed must exist.** If there is still no odds data after waiting (up to 3 s more for the
   first poll) and fail-closed is on → reject `FEED_UNAVAILABLE`.
6. **Market type from the feed.** `deriveBufferFlags()` works out what kind of market this
   really is (price-guarded, khado, live-tracked, line) from the **feed**, not from the player.
7. **Safety checks — each one can reject:**
   - `RUNNER_NOT_IN_MARKET` — the selection is not one of the market's runners;
   - `MARKET_TYPE_MISMATCH` — the player said "line" or "khado" but the feed says otherwise;
   - `SUSPENDED:<status>` — `finalSuspensionStatus()` finds the market or runner closed;
   - `KHADO_NO_QUOTE` / `KHADO_DRIFT` — for khado, the line and band must match the feed;
   - `FANCY_DRIFT` — for fancy markets, `fancyOddsDrift()` finds the price has moved;
   - `BLOCKED_IN_BUFFER` — the market was suspended during the wait.
8. **Final odds.** For live-tracked markets the final odds = the **current live odds** from the
   feed. If there is no live price → reject `NO_LIVE_PRICE`.
9. **Special cases:**
   - **Khado / own line** — keep the slip odds.
   - **Cash-out** — work the stake out again from the live odds so the cash-out amount stays
     right; reject `CASHOUT_RANGE` if the new stake is invalid or too large.
   - **Player edited the odds by hand** — `manualBetLiveCheck()`: accept only if the live price
     is the same or better for the player, otherwise reject `MANUAL_LIMIT`.
   - **Normal bet** — `autoBetCheck()`: on Match Odds / Bookmaker markets accept only if the
     live price is the same or better than what the player clicked, otherwise reject
     `ODDS_MOVED`.
10. **Always** `liveOdds.release(gmid)` at the end (in `finally`) so the poller can stop.

### 3.3 `resolveBufferSeconds(body, sb, liveTracked)`
**Location:** `modules/bets/buffer/betBuffer.mjs:28`

Finds how many seconds to wait. First it asks the admin config
(`BettingConfigService.getSportsBufferSeconds`, `lib/services/BettingConfigService.mjs:116`) for
this sport / market / league. If nothing is set it uses the defaults:
`BET_BUFFER_DEFAULT_SECONDS` (5) for live markets, `FANCY_BUFFER_DEFAULT_SECONDS` (3) for others.

### 3.4 `liveList(gmid)`
**Location:** `modules/bets/buffer/betBuffer.mjs:24`

Returns the latest odds list for the event, but only if it is fresh (younger than
`LIVE_ODDS_MAX_AGE_MS`, default 5 s). Old data counts as "no data".

### 3.5 `applyDecision(body, d)`
**Location:** `modules/bets/buffer/betBuffer.mjs:192`

Writes the buffer's answer back into `req.body`:
- `odds` and `user_rate` = final odds (2 decimals);
- `runners`, `team_one`, `team_two` = runner list from the feed;
- `size` / `back_size` / `lay_size` = live size;
- `stake_amount`, `original_amount`, `amount` = final stake (only changes for cash-out).

This is why `placeBet` can trust these values: they came from the server, not the player.

### 3.6 `getBetResult(req, res)` — `GET /bet-result/:client_ref`
**Location:** `modules/bets/buffer/betBuffer.mjs:279`

If the player refreshes the page while a bet is being placed, the frontend calls this with the
`client_ref` to find out what happened: `pending`, `accepted`, `rejected` or `unknown`.

### 3.7 `checkBetLive(body)`
**Location:** `modules/bets/buffer/betBuffer.mjs:273`

Runs the buffer checks **without waiting** (`noWait: true`) and applies the decision. Used by
the combined slip (`placeCombinedBet`) to check each leg.

---

## 4. Buffer helpers

### 4.1 Duplicate guard — `modules/bets/buffer/betInflight.mjs`

An in-memory map of `userId:client_ref → { state, status, body }`.

| Function | Line | What it does |
|---|---|---|
| `cleanRef(ref)` | 7 | Accepts the ref only if it is 8–64 letters, digits or `-`. |
| `begin(userId, ref)` | 15 | If the ref is already known, return it. Otherwise save it as `pending` and return `null`. |
| `finish(userId, ref, body, status)` | 22 | Save the final answer as `accepted` or `rejected`. |
| `get(userId, ref)` | 30 | Read a saved entry (used by `getBetResult`). |
| `sweep()` | 8 | Runs every minute; removes entries older than `BET_OUTCOME_TTL_MS` (5 min). |

Note: this map lives in the memory of one process. If the sports service runs several copies,
each copy has its own map.

### 4.2 Live odds poller — `modules/bets/buffer/liveOdds.mjs`

One poller per event, shared by every bet on that event.

| Function | Line | What it does |
|---|---|---|
| `acquire(gmid, sid)` | 23 | Start a poller for the event (or join the one already running). It polls every `LIVE_ODDS_POLL_MS` (700 ms). Returns the first poll's promise. |
| `pollOnce(gmid, p)` | 7 | Calls `CricketService.GetMatchPrivateData(gmid, sid)` (the odds feed) and stores the market list with the time. |
| `release(gmid)` | 37 | One bet is done. When no bet uses the poller any more, it stops. |
| `snapshot(gmid)` | 47 | Returns `{ list, ageMs }` — the latest odds and how old they are. |

### 4.3 Rules — `modules/bets/buffer/betBufferRules.mjs`

Pure functions (no database), easy to test.

| Function | Line | What it does |
|---|---|---|
| `isLaySide(betType)` | 7 | `true` for `lay` or `no`. |
| `feedSideFor(betType, inverted)` | 8 | Which side of the feed to read (`back` or `lay`). Line markets read the opposite side. |
| `isBlockedGameStatus(gs)` | 12 | `true` for `SUSPENDED`, `BALL RUNNING`, `INACTIVE`. |
| `isBookieFavourMarket(type)` | 22 | `true` for Match Odds, Bookmaker, Bookmaker 2, Tied Match. |
| `findMarket(list, id)` | 26 | Find the market in the feed by its id. |
| `findRunner(mkt, selId, name)` | 27 | Find the runner by selection id, or by name. |
| `readBufferTick(...)` | 41 | One look at the feed: returns `live` (with odds and size), `blocked` (with status) or `skip`. |
| `finalSuspensionStatus(...)` | 55 | Last check before accepting: returns the blocking status, or `null` if open. |
| `fancyOddsDrift(...)` | 65 | For fancy markets: finds the feed price closest to the player's price. If the gap is more than 0.01 → `mismatch`. |
| `deriveBufferFlags(...)` | 88 | Reads the market type from the feed: `priceGuarded`, `ownLine` (khado), `liveTracked`, `lineMarket`. |
| `feedRunners(...)` | 105 | The runner names from the feed. The player's runner list is never trusted. |
| `khadoQuote(...)` | 112 | For khado markets: the line, band and rate from the feed. |
| `manualBetLiveCheck(...)` | 118 | Hand-edited odds: back needs live ≥ edited, lay needs live ≤ edited. |
| `autoBetCheck(...)` | 122 | Same rule for normal bets, but only on price-guarded / bookie markets. Other markets always accept. |
| `readMarketList(body)` | 132 | Digs the market array out of the feed reply (it can be nested under `data` a few times). |

---

## 5. Layer 2 — The controller

### 5.1 `placeBet(req, res, opts)`
**Location:** `modules/bets/controllers/sportbetscontroller.mjs:477`

`opts` is only used by the combined slip:
- `opts.transaction` — use this transaction instead of opening a new one;
- `opts.skipMinStake` — do not check minimum stake;
- `opts.createdAt` — fixed time for all legs of one slip.

At the start it opens a database transaction (line 481). **Every early exit rolls it back.**

#### Step 1 — Read the request (lines 518–576)
- Player id from `req.user.account.id`. Missing → `400 "User ID is required"`.
- Reads the body: `game_type`, `match_id` (market id), `eventid` (match id), `selection_name`,
  `bet_type`, `odds`, `stake_amount`, `runners`, `market_type`, `sid` (sport id), etc.
- `count` = number of runners.

#### Step 2 — Currency (lines 561–577)
- `currency` (or older `original_currency`) is required → else `400 "currency is required"`.
- A player created by an agent (`parent_staff_id` set) may only bet in **INR** → else
  `400 "Your account can only bet in INR"`.
- The original stake is kept as `currency_amount`, then the stake is converted to INR with
  `toInr()`. **From here on, every amount is in INR.**

#### Step 3 — Extra info (lines 578–592)
- Player IP (`x-forwarded-for`) and browser (`user-agent`) are saved with the bet.
- League name is resolved with `leagueNameForBet()`
  (`lib/services/SportsLeagueResolver.mjs:68`).
- Hidden sport / league checked again (the client could lie) → `400`.

#### Step 4 — Lock checks (lines 593–651)
Each lock returns `403` with a message if the bet is not allowed:

1. `BetLockService.isBettingAllowed()` — the player or anyone above them is bet-locked.
2. `checkUserBetLock()` — a lock on this player for this market type, match or market.
3. `checkPlatformBetLock()` — the owner or an upline staff locked this market for the sport.
4. `SportsLockController.checkSportsLock()` — sport / series / match / market lock.

(Each function is explained in section 6.)

#### Step 5 — Stake limits (lines 653–704)
- **Line markets:** limits from the admin config (`getMarketLimits`), else defaults
  `LINE_MARKET_MIN_STAKE` (100) and `LINE_MARKET_MAX_STAKE` (100000).
- **Other markets:** `resolveMarketLimits()` reads the feed's min / max for this market and
  runner; an admin override wins.
- A **virtual limit** for the sport / league (`getVirtualLimit`) wins over both.
- If nothing can be found: `MIN_STAKE_DEFAULT` (0) and `MAX_STAKE_HARD_CAP` (500000).
- Cash-out bets and combined legs skip the minimum check.
- Errors: `Minimum bet amount is X` / `Maximum bet amount is X`.

#### Step 6 — Horse racing window (lines 706–726)
Only for horse racing (`sid = 10`): bets are only taken in the last `RACE_BET_WINDOW_MINUTES`
(5) before the race starts. Start time comes from `resolveRaceStartMs()`. If the start time
cannot be found, the check is skipped.

#### Step 7 — Max odds rule (lines 727–750)
`BettingConfigService.getMaxOddsRule()` may set a top odds for the sport / market. If the odds
are higher → error `RATE_OVER_LIMIT`. Some rules only apply to limited-overs cricket, so Test
matches are left out.

#### Step 8 — Basic values (lines 751–768)
- `BOOKMAKER` → `BM`, `FANCY` → `FAN`.
- Works out if this is a fancy, bookmaker or match-odds bet.
- `stake <= 0` → `Invalid stake`. Odds must be a positive number (and ≥ 1 for non-fancy).

#### Step 9 — Lock the wallet and old exposure (lines 774–791)
- `Credits.findOne({ uid: user_id }, lock: UPDATE)` — the player's INR balance (`credits.inr`).
  **Row lock:** a second bet from the same player has to wait until this one finishes, so the
  same money cannot be spent twice.
- `UserExposure.findAll(..., lock: UPDATE)` — the player's current exposure on this market,
  one row per runner (`team_name → exposure_amount`).

#### Step 10 — Calculate new exposure (lines 793–1958)
"Exposure" = how much the player can lose on each outcome. A negative number is a possible loss.

Most of these lines are long lists of market names used to decide which formula to use:

| Market kind | How exposure is worked out |
|---|---|
| **MO / BM runner not in the feed list** | Rejected with `GAME_SUSPEND` (line 1714). |
| **Fancy / session / line / meter / badlo** (line 1717) | For every possible run score, add up the win or loss of **all the player's open bets** on that selection, plus this new one. The worst result is the exposure. Uses `linePnl`, `meterPnl`, `badloPnl`. |
| **Match Odds (MO)** | `calculateRunnerExposure()` with the odds as they are. |
| **Bookmaker (BM)** | Odds are changed to decimal first with `normalizeOdds()`, then `calculateRunnerExposure()`. |
| **Other non-fancy markets** (Tied Match, Under/Over, Game Winner…) | Simple two- or three-way formula with "The Draw". |
| **BM-style fancy / big-runner session markets** | `calculateRunnerExposure()`. |
| **Anything else** | Error `bet is closed for this market`. |

#### Step 11 — How much money to block (lines 1959–1987)
- `oldMax` = the biggest possible loss **before** this bet.
- `newMax` = the biggest possible loss **after** this bet.
- `balanceChange = newMax − oldMax` (or `newMax` if this is the first bet on the market).
  - positive → take this much from the balance;
  - negative → this bet **lowers** the risk (a hedge), so money is given back.
- Not enough balance → error `Bet Not Confirm Check Exposure Limit And Balance` (fancy) or
  `Bet not confirm check balance.` (others).

This is why a hedge bet can be placed with zero balance: it does not add risk.

#### Step 12 — Save exposure (lines 1988–2003)
`UserExposure.upsert()` for every runner with its new exposure amount.

#### Step 13 — Liability of this one bet (lines 2004–2030)
`singleBetLiability` = how much this single bet can lose (stake for back, stake × (odds − 1)
for lay, with special formulas for fancy1, oddeven, Tied Match, line, meter and badlo).
It is saved on the bet row; settlement and reports use it.

#### Step 14 — Save the bet (lines 2044–2092)
`SportsBet.create()` writes the bet row with `status: "open"`. Important fields:
- `stake_amount` (INR), `original_currency`, `original_amount`, `usd_amount` (worked out on the
  server with `inrToUsd`, `lib/helper/toInr.mjs:46`);
- `odds`, `bet_type` (back/lay become yes/no for fancy), `liability`;
- `exposure_after_bet`, `runners`, `market_type`, `gtype`, `league_name`, `ip_address`, `browser`;
- `unmatched: false` always — there is no matching engine; every accepted bet is filled at once.

#### Step 15 — Move the money (line 2093)
`walletUpdate()` changes `credits.inr` and writes the ledger (section 6.6).

#### Step 16 — Total exposure (lines 2101–2127)
Runs `TOTAL_EXPOSURE_SQL` (`lib/helper/totalExposure.mjs:8`) to add up the player's exposure
across all markets, and saves it in `TotalExposure`.

#### Step 17 — Commit and reply (lines 2128–2149)
- `transaction.commit()` — now everything is saved for real.
- `pushBalance(user_id)` — sends the new balance and exposure to the player's screen by socket.
- Reply:
  ```json
  {
    "success": true,
    "exposure": { "<match_id>": { "match_title": "...", "teams": { "Team A": -100, "Team B": 90 } } },
    "balanceDelta": -100,
    "oldBalance": 1000,
    "newBalance": 900,
    "totalExposure": 100
  }
  ```
- Any error thrown in steps 5–16 → `transaction.rollback()` → `400 { success: false, error }`.
  Nothing is saved and no money moves.

(When `placeBet` runs with a transaction from `placeCombinedBet`, it does not commit, roll back
or push; the combined slip does that once for all legs.)

---

## 6. Controller helpers

All in `modules/bets/controllers/sportbetscontroller.mjs` unless written otherwise.

### 6.1 `normalizeOdds(odds)` — line 99
Changes bookmaker-style odds (e.g. `40` meaning 40 paise) into decimal odds (e.g. `1.40`).

### 6.2 `calculateRunnerExposure({ runners, selectedRunner, stake, odd, betType, oldExposures })` — line 104
For Match Odds / Bookmaker. Starts from the old exposure and, for each runner:
- **Back** on runner X: X gets `+ stake × (odds − 1)` (win); every other runner gets `− stake`.
- **Lay** on runner X: X gets `− stake × (odds − 1)` (loss); every other runner gets `+ stake`.

Returns the new exposure for every runner.

### 6.3 `resolveMarketLimits({ eventid, sid, match_id, mname, market_type, selection_name })` — line 126
Finds min and max stake for the market:
1. Reads the admin override (`BettingConfigService.getMarketLimits`).
2. Reads the feed (`CricketService.GetMatchPrivateData`), finds the market and the runner.
3. Takes the feed's min / max, and lets the admin override win when it is set.
Returns `{ minLimit, maxLimit, marketName }`, or `null` if nothing is found.

### 6.4 `resolveRaceStartMs(eventid, sid)` — line 187
Gets the race start time from the feed board (`CricketService.fetchCricketData`).
Helpers: `findRaceNode()` (line 179) searches the board tree for the race, and
`parseFeedIstTime()` (line 163) turns the feed's Indian-time text into a timestamp.

### 6.5 `getMarketNameFromGtype({ mname, gtype, nat, section })` — line 195
Builds a readable market name (e.g. `"India vs Australia"`). Only logged in `placeBet`.

### 6.6 `walletUpdate(wallet, balanceChange, transaction, context)` — line 394
Moves the money on the locked `credits` row:
- `balanceChange < 0` → **add** the amount back to `credits.inr`, ledger label `BET_RELEASED`.
- `balanceChange > 0` → **take** the amount from `credits.inr`, ledger label `BET_PLACED`, and
  write a `DebitLedger` row (`reason: "bet_placed"`, amount, new balance, bet id).
- `balanceChange` is `NaN` → logs an error and changes nothing.

The ledger label goes into `point_ledger_direct` (through `directLedgerContext`), which the
player's sports statement reads.

Note: the money is only taken if the balance is enough, but `placeBet` already checked that in
step 11, so in practice it always is.

### 6.7 `checkUserBetLock(user_id, game_type, event_id, transaction, market_id)` — line 225
Player-level locks, checked in this order:
1. `BetLock` row for the player: `MatchOdds` locked (for MO bets) or `OtherMarkets` locked.
2. `UserMatchLocks`: this whole match is locked for the player.
3. `UserEventMarketLocks`: this market is locked for the player.
4. The same market lock for **every staff above** the player (walks up `parent_staff_id`).
Returns `{ allowed: true }` or `{ allowed: false, message }`. Any error → not allowed.

### 6.8 `getAllAncestorStaffIds(userId, transaction)` — line 337
Returns the list of staff ids above the player, from the direct parent up to the top.

### 6.9 `checkPlatformBetLock(sportsId, game_type, user_id, transaction)` — line 352
Looks in `StaffMarketLocks` for a lock on this sport, by the owner (`staff_id = null`) or any
upline staff, for this market type or `"ALL"`. Found → not allowed, with
`"Bet not allowed, <market> is locked by <Owner/upline staff>."`

### 6.10 `BetLockService.isBettingAllowed(userId, { transaction })`
**Location:** `modules/bets/services/BetLockService.mjs:5`

Checks the `bet_locked` flag:
1. On the player (`users.bet_locked`).
2. If the player was made by an owner directly → allowed.
3. Otherwise walk up the staff chain; if any staff has `bet_locked = true` → not allowed.
Any error → not allowed (safe default).

### 6.11 `SportsLockController.checkSportsLock(userId, sportId, seriesId, matchId, marketId, options)`
**Location:** `modules/sports-config/controllers/SportsLockController.mjs:137`

Checks sport / series / match / market locks in `UserSportsLock` (on the player) and
`StaffSportsLock` (on each staff above, and the owner). Returns a message telling the player
which upline to contact.

### 6.12 `toInr(amount, currency)`
**Location:** `lib/helper/toInr.mjs:26`

Converts the stake to INR using the `public.exchangerate` table
(`amount × coin_usd_rate ÷ inr_usd_rate`, 2 decimals). INR is returned as it is. A currency with
no rate → error `No exchange rate for X`.

### 6.13 `pushBalance(userId)`
**Location:** `lib/helper/pushBalance.mjs`

After commit, reads the player's wallet and total exposure and sends them over the socket
(`emitBalanceUpdate`, `lib/utils/socketUtils.mjs:24`). Runs in the background; if it fails, the
saved bet is not affected.

---

## 7. Combined slip — `POST /place-combined`

**Location:** `modules/bets/controllers/sportbetscontroller.mjs:2164` (`placeCombinedBet`)

Places several selections on the **same market** as one slip (also used for badlo pairs):
1. Checks the slip: at least 2 legs, at most `MAX_COMBINED_LEGS`, same market, same side
   (all back or all lay), different runners, valid stake, currency given.
2. Checks total stake limits once with `resolveMarketLimits()`.
3. Runs `checkBetLive(leg)` on each leg (buffer checks, no wait).
4. Opens **one** transaction and calls `placeBet(legReq, legRes, { transaction, skipMinStake: true, createdAt })`
   for each leg. `makeLegRes()` (line 2152) is a fake `res` that catches each leg's answer.
5. If any leg fails, everything is rolled back. Otherwise commit once.

---

## 8. Tables touched by one bet

| Table / model | What happens |
|---|---|
| `credits` (`Credits`) | Locked, then `inr` goes down (or up for a hedge). |
| `user_exposures` (`UserExposure`) | Locked, then one row per runner is upserted. |
| `SportsBet` (`SportsBet`) | New row, `status = open`. |
| `debit_ledger` (`DebitLedger`) | New row when money is taken. |
| `point_ledger_direct` | Ledger entry named `BET_PLACED` / `BET_RELEASED`. |
| `total_exposures` (`TotalExposure`) | Player's total exposure upserted. |
| Read only | `users`, `staff`, `betlocks`, `user_match_locks`, `user_event_market_locks`, `staff_market_locks`, sports lock tables, `platform_games`, `exchangerate`, betting config. |

---

## 9. Error codes the player can get

| Where | Reply | Meaning |
|---|---|---|
| Middleware | `503 FEED_SPORTS_DISABLED` | Sports is switched off. |
| Middleware | `CURRENCY_NOT_SUPPORTED_FOR_SPORTS` | Custom coin used. |
| Buffer | `409 pending` | Same `client_ref` is still being placed. |
| Buffer | `400` + `code` (`ODDS_MOVED`, `FANCY_DRIFT`, `SUSPENDED:…`, `FEED_UNAVAILABLE`, `RUNNER_NOT_IN_MARKET`, `BLOCKED_IN_BUFFER`, `NO_LIVE_PRICE`, `MANUAL_LIMIT`, `CASHOUT_RANGE`, `KHADO_*`, `MARKET_TYPE_MISMATCH`, `NO_MARKET_REF`) | Price moved, market closed, or feed missing. |
| Controller | `403` | A lock blocks the bet. |
| Controller | `400` | Bad input, limits, race window, max odds, balance too low, market closed. |

---

## 10. Settings (environment variables)

| Variable | Default | Used for |
|---|---|---|
| `SERVER_SIDE_BET_BUFFER` | `true` | `false` turns off the wait (checks still run). |
| `BET_FEED_FAIL_CLOSED` | `true` | `false` lets bets through when the odds feed is missing. |
| `BET_BUFFER_DEFAULT_SECONDS` | `5` | Wait time for live markets. |
| `FANCY_BUFFER_DEFAULT_SECONDS` | `3` | Wait time for fancy markets. |
| `LIVE_ODDS_MAX_AGE_MS` | `5000` | Odds older than this are ignored. |
| `LIVE_ODDS_POLL_MS` | `700` | How often the feed is polled. |
| `BET_OUTCOME_TTL_MS` | `300000` | How long a `client_ref` answer is kept. |
| `LINE_MARKET_MIN_STAKE` / `LINE_MARKET_MAX_STAKE` | `100` / `100000` | Line market default limits. |
| `MIN_STAKE_DEFAULT` / `MAX_STAKE_HARD_CAP` | `0` / `500000` | Limits when nothing else is found. |
| `RACE_BET_WINDOW_MINUTES` | `5` | Horse racing betting window. |

---

## 11. Not covered here

Casino in-house games (crash, keno, etc.) use a different flow: sockets in
`services/casino/src/modules/in-house/sockets.js` call `GameEngine.placeBet`
(`services/casino/src/modules/in-house/engine/gameEngine.js:93`).

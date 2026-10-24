# Setup

Getting this backend running on a machine that has never seen it.

```bash
cd backend
npm run setup          # or: npm run setup:demo, to get accounts to log in with
npm run dev
```

That is the whole thing. `npm run setup` is interactive — it asks for your
Postgres host, port, database name, user and password, and every question has a
default you can accept with enter. Everything after that is automatic.

The gateway comes up on **http://127.0.0.1:4000**.

```bash
curl localhost:4000/health     # aggregated platform health — all four services
curl localhost:4000/api/v1     # endpoint index
```

---

## Before you start

| | |
| --- | --- |
| **Node** | 20 or newer. `node -v` |
| **PostgreSQL** | 14 or newer, running, and you know a user that can `CREATE DATABASE`. |
| **Redis** | Optional. Without it every service falls back to an in-process cache — fine for one machine, wrong for more than one. |

Nothing else. You do not need to create the database, run migrations, generate
secrets or write a `.env` — setup does all of it.

---

## What `npm run setup` actually does

| Step | What happens |
| --- | ---: |
| 1. Preflight | Node version, workspace root, whether Postgres tooling is around |
| 2. `.env` | Created from `.env.example` if missing, then **repaired** — see below |
| 3. Install | `npm install` across the workspace |
| 4. Database | `create` → 37 migrations → the bootstrap seeders |
| 5. Grants | Per-service Postgres roles, if `.env` names any |
| 6. Data | Platform configuration, and the demo dataset with `--demo` |
| 7. Verify | All 163 models checked against the real schema |

### Step 2 is the one that matters

`.env.example` on its own does not produce a platform that starts. Setup fills
the gaps:

- **Eight secrets** are generated, 32 random bytes each. Three of them must
  differ from one another or production refuses to boot; generated values never
  collide, and a hand-edited file that does collide gets one regenerated.
- **`SOCKET_ALLOWED_ORIGINS`** is added. It is not in `.env.example` and it has
  no default — unset means no browser can open a socket to any of the three
  services that serve one, and the only symptom is a silent CORS rejection in
  the client.
- **`SPORTS_FEED_KEY`** is filled. It is in `.env.example` but empty, and
  sports-service declares it required with no default — so it exits at boot,
  and the dev runner stops every other service along with it.

**Existing values are never overwritten.** Setup only touches variables that are
empty or still hold an example placeholder, so running it against a `.env` you
have configured is safe. Re-run it as often as you like.

---

## Flags

```bash
node scripts/setup.js --help
```

| Flag | |
| --- | --- |
| `-y`, `--yes` | Accept every default, ask nothing. For CI and scripts. |
| `--demo` | Load the demo dataset as well — staff tree, players, content. |
| `--no-data` | Schema and bootstrap seeders only. |
| `--fresh` | **DROP the database** and rebuild it. Asks first, unless `--yes`. |
| `--skip-install` | Do not run `npm install`. |
| `--skip-db` | Configure `.env` and touch no database. |
| `--new-secrets` | Regenerate every secret, including ones already set. |

Target a different database for one run without editing anything:

```bash
DB_NAME=ibitplay_scratch node scripts/setup.js --yes --demo
```

A real environment variable outranks `.env`, the same way it does for every
service in this platform.

---

## The data runner

`scripts/seed-data.js` is separate from setup and can be run whenever you want.
**Every dataset is idempotent** — it adds what is missing and changes nothing
else, so running it twice does nothing the second time and running it against a
database somebody has been using does not overwrite their edits.

```bash
npm run db:seed:list      # what each dataset writes
npm run db:seed:data      # platform configuration
npm run db:seed:demo      # configuration + the full demo cast
```

### Datasets

**`config`** — run by default, safe on any database.

| | |
| --- | --- |
| `bootstrap` | The tracked seeders: 7 roles, the super-admin, the in-house catalogue |
| `siteconfig` | The single settings row; fills tip limits (500 / 2000 / 0 USD) and starter first-deposit tiers where unset (the bonus switch stays off) |
| `sports` | All 19 sports the feed knows, with cricket, soccer and tennis enabled |
| `spinwheel` | Deposit-spin config and 8 weighted slices |
| `rates` | Starter exchange rates for 25 currencies — **placeholder values** |
| `games` | All 20 in-house games in the `js_games` catalogue |
| `vaultterms` | The vault lock terms (flexible, 7d, 30d, 90d) where missing |
| `features` | A `site_features` row for every catalogue feature and the 4 policies (reward currency USDT) where missing — every section the player site gates on is switched on; push notifications / analytics stay off until their keys are set |

**`demo`** — needs `--demo`, refuses to run with `NODE_ENV=production` unless
you also pass `--force`. Every account's username **and** email start with
`demo_`.

| | |
| --- | --- |
| `staff` | `demo_superadmin` → `demo_admin` (+ `demo_executive`) → `demo_subadmin` → `demo_supermaster` → `demo_master` → `demo_agent`, `demo_agent2`, with hierarchy rows, floats and transaction passwords |
| `players` | Agent-tree players `demo_player01…06`, split across the two agents and funded from the agent's float |
| `direct` | 15 direct players, one per state: fresh, depositor, multi-coin, KYC pending/verified/rejected, four VIP cards, bonus, affiliate + 3 referees, tips off, vault; saved bank/UPI, notifications |
| `cashier` | Fiat deposits pending/approved/rejected and withdrawals In Queue/Approved/Rejected |
| `vip` | Turnover through the wager feed → VIP cards, rakeback rate, level-up credits, rakeback accrued (one claimed); with `--history` the cards are reached over the window instead |
| `bonuses` | A completed and an active (locked) bonus on `demo_bonus` |
| `affiliate` | Team rows and commission from the referees' turnover, some claimed |
| `tips` | Tips between direct players |
| `vault` | A flexible and a 30-day vault deposit with interest |
| `content` | A few published blog posts |
| `payments` | Manual INR deposit details, so the deposit screen has a method |

Demo money moves through the real services (wallet, fiat deposit/withdraw,
tips, bonuses, vault, wager feed, the agent float), so every demo wallet equals
the sum of its ledger; the run ends by checking that.

### Options

```bash
node scripts/seed-data.js --only sports,rates      # just these
node scripts/seed-data.js --demo --skip bootstrap  # everything except these
node scripts/seed-data.js --demo --players 20      # agent-tree players (default 6)
node scripts/seed-data.js --demo --balance 50000   # opening INR per agent-tree player
node scripts/seed-data.js --reset-demo             # dry run: what a reset deletes
node scripts/seed-data.js --reset-demo --yes       # delete every demo_ account and its rows
node scripts/seed-data.js --demo --history         # + 90 days of backdated activity for the charts
node scripts/seed-data.js --history 30             # history only, on a database already seeded with --demo (keeps its VIP lump)
node scripts/seed-data.js --demo --history 180 --history-seed 3   # longer span, another variation
```

`--reset-demo` deletes only `demo_`-prefixed players and staff and everything
keyed on them (ledger, tips, bonuses, vault, KYC, sessions, notifications,
rewards, team rows, fiat rows, preferences, wallets, staff rows), children
first, in one transaction. It refuses if a non-demo account hangs under a demo
staff account. Configuration rows are never touched.

### History for the admin charts (`--history`)

Without it, every demo movement happens at seed time and each chart is one spike
on today. `--history [days]` (default 90, max 365; code in
`scripts/lib/demo-history.js`) gives the demo cast a past:

- **Who:** about 0.8 new players per day (`demo_h001…`, passwords in the
  credentials file like every demo account), signing up along a growing curve,
  plus the base cast's signup dates moved into the first third of the period.
  `demo_h001` is an affiliate; about a quarter of the later players are its referees.
- **What:** fiat deposits (INR/EUR, approved/pending/rejected) and crypto deposits
  (USDT/BTC/ETH/TRX, through the CCPayment webhook handler with a local signing
  secret: Success/Failed/Processing), casino rounds on three providers (in-house `bets`,
  jsGames v2 `game_transactions`, GIS `gis_transactions`) and many catalogue games,
  sports bets that settle won/loss/void, tips, vault in/out, first-deposit and reload
  bonuses with their wagering, rakeback claims, VIP level-ups, affiliate commission
  and claims, withdrawals (In Queue/Approved/Paid/Rejected), and a few full and
  partial refunds through `WagerActivityService.reverse`.
- **Shape:** weekday/weekend rhythm, growth over the period, a few promo spikes,
  evening-heavy hours, whales/regulars/casuals/churners. A seeded PRNG
  (`--history-seed`, default 7) makes a run reproducible.

For the default 90 days that is about 7,000 events (roughly 1,900 in-house
rounds, 1,900 jsGames rounds, 1,700 GIS rounds, 750 sports events, 200 fiat and
130 crypto deposit events, 65 withdrawal events, 35 tips, 37 vault moves, 60
bonuses) and about 8,600 ledger rows. It takes about a minute.

Money still goes through the real services (wallet, cashier, crypto webhook,
tips, vault, bonuses, rakeback, affiliate, wager feed), so every wallet still
equals its ledger; the run ends with `WalletService.reconcile` on every demo
wallet and **fails** on any mismatch. No provider or external API is called: a
round or a sports bet is its ledger movement plus the provider-side record,
written locally.

**Backdating.** Each event's wall-clock window is recorded. At the end, in one
transaction, every timestamp a **demo player's** row got inside one of those
windows is moved back to when the event is meant to have happened. Only tables
keyed on a player (the reset's list, `users`, `team`) and only rows owned by a
`demo_` player are touched, so a real player's row, even one written during the
run, is never moved. Because events run oldest first, cross-table order holds: a
deposit lands before the wagers it funds, a bet settles after it was placed, a
withdrawal comes after a deposit.

**Idempotent by tag.** Every history ledger movement's idempotency key starts
with `demo-history:`. If any demo player already has one, `--history` says so
(with the span it found) and does nothing. To regenerate (another span or
seed): `--reset-demo --yes`, then `--demo --history`. The reset removes all
history rows, because each one is keyed on a demo player.

**The VIP cast grows into its cards.** Alone, `--demo` puts each VIP player on its
card with one wager on seed day (Gold is $110,000). With `--demo --history` the
`vip` dataset leaves that wager out, and the history plan wagers what each VIP
player still needs in many rounds (source `demo_seed`, no bet, no wallet move)
from its signup to the end of the window, following the weekday rhythm and
growth but not the promo spikes. The cards, level-up credits and rakeback accrual
climb gradually, every player is on its documented card when the run ends, and
`demo_vip_silver` claims its rakeback after its last round.

`--history` on a database already seeded with plain `--demo` keeps that seed-day
lump (the run warns and names the players). For a chart with no spike, start
clean: `--reset-demo --yes`, then `--demo --history`.

The other base `--demo` rows (the cashier queue, tips, bonus and affiliate
turnover) still sit on the day they were seeded.

---

## Logging in

Setup prints the super-admin login when it finishes. Both go through the gateway on port 4000.

**Staff** — `POST /api/v1/admin/auth/login`

```json
{ "email": "admin@ibitplay.local", "password": "ChangeMe!2026" }
```

**Players** — `POST /api/v1/user/auth/login`. Note the field is `identifier`,
not `username`.

**Demo accounts have a random password each.** They are never printed: the
seed writes them (login, email, password, role, staff transaction password) to
`backend/.demo-credentials.local.md`, which is gitignored and mode 0600
(`DEMO_CREDENTIALS_FILE` moves it). The terminal only says how many accounts
were created and where that file is.

**Accounts that already exist are never given a new password.** A re-run adds
only the accounts that are missing, and appends only their rows to the file.
`--reset-demo --yes` removes that database's rows from the file.

---

## IP geolocation (login history)

Every login and registration records where the player's IP is: country, region,
city, zip, lat/lon and timezone in `ip_locations` (one row per address, migration
064), linked from `user_login_history.ip_location_id`. The lookup runs after the
session is issued, so it never slows a login. Code:
`services/user/src/modules/auth/geo/ipLocation.js`.

| `GEO_PROVIDERS` entry | what | free quota |
|---|---|---|
| `ipinfo` | `https://ipinfo.io/<ip>/json`, `IPINFO_TOKEN` optional (Bearer) | ~50k/month |
| `ipwhois` | `https://ipwho.is/<ip>` | 1,000/day |
| `local` | offline DB-IP lite file in `data/geoip` (`npm run geoip:update`) | none |

Each call has a 2-second timeout. A provider answering 429/403, or failing 3
times in a row, is skipped for 10 minutes. Answers are cached in memory (5k
addresses, 24h), and an `ip_locations` row resolved online in the last 30 days
is reused without a call.

**Privacy.** With `GEO_LOOKUP_ENABLED=true` (the default) each player's public
IP is sent over HTTPS to the third-party provider. Private, loopback,
link-local, CGNAT and IPv6 ULA addresses are never sent. Mention the processor
in the privacy policy, or set `GEO_LOOKUP_ENABLED=false` to keep IPs on the
server (offline file only). Info-level logs carry hourly provider counts, never
an address; lower levels mask the last octet.

If you run the per-service database roles, re-run `node tools/db-grants.js --apply`
after migrating so the user-service role can read and write `ip_locations`.

## Things that will still be wrong

Setup gets the platform running. It cannot invent credentials that belong to
someone else.

| | |
| --- | --- |
| **`SPORTS_FEED_URL` / `SPORTS_FEED_KEY`** | Placeholders. The sportsbook will start and its board will be empty until these point at the real provider. |
| **Exchange rates** | Plausible but made up. Every swap is priced off them — update them before real money moves. |
| **Payment details** | The demo bank account and UPI id are fake. |
| **The super-admin password** | `ChangeMe!2026` until you change it. |

Before this goes anywhere public, read
[docs/ROTATION.md](ROTATION.md) — there are committed credentials in `legacy/`
that matter more than anything on this page.

---

## When something goes wrong

**`Invalid environment configuration: SPORTS_FEED_KEY is required`**
Run `npm run setup` again. It fills this.

**`permission denied for table staff` on the first request, but `/health` is green**
`.env` names per-service database roles (`DB_USER_ADMIN_SERVICE` and friends)
that have no grants in this database. Those roles are cluster-wide, the grants
are per-database. Fix:

```bash
npm run db:grants
```

Note this **rotates** the role passwords and prints the new ones — setup writes
them back into `.env` for you, but if you run the tool by hand you have to paste
them in yourself.

**`database "ibitplay" does not exist`**
Postgres is reachable but the database is not there. `npm run setup` creates it;
check that `DB_USER` in `.env` is allowed to `CREATE DATABASE`.

**Connection refused on 5432**
Postgres is not running. `brew services start postgresql@16`, or start your
container.

**A service dies and takes the others with it**
By design — `scripts/dev.js` stops everything when one child exits, because a
half-running platform is more confusing than a stopped one. Scroll up: the last
lines before the shutdown say which service and why.

**Start over completely**

```bash
node scripts/setup.js --fresh --demo
```

---

## Useful commands

```bash
npm run dev                  # gateway + all four services + the sports worker
npm run dev user casino      # only the named services
npm run db:status            # migrations and seeders: applied vs pending
npm run db:verify            # every model checked against the real schema
npm run db:grants:check      # what each service role can actually reach
npm test                     # the full suite
```

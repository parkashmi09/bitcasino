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
npm run db:seed:demo      # configuration + demo accounts and content
```

### Datasets

**`config`** — run by default, safe on any database.

| | |
| --- | --- |
| `bootstrap` | The tracked seeders: 7 roles, the super-admin, the in-house catalogue |
| `siteconfig` | The single settings row every feature flag hangs off |
| `sports` | All 19 sports the feed knows, with cricket, soccer and tennis enabled |
| `spinwheel` | Deposit-spin config and 8 weighted slices |
| `rates` | Starter exchange rates for 25 currencies — **placeholder values** |
| `games` | All 20 in-house games in the `js_games` catalogue |

**`demo`** — needs `--demo`, refuses to run with `NODE_ENV=production` unless
you also pass `--force`.

| | |
| --- | --- |
| `staff` | A four-deep staff tree under the super-admin, with hierarchy and balances |
| `players` | Player accounts with a funded INR balance, wallet row and preferences |
| `content` | A few published blog posts |
| `payments` | Manual INR deposit details, so the deposit screen has a method |

### Options

```bash
node scripts/seed-data.js --only sports,rates      # just these
node scripts/seed-data.js --demo --players 25      # 25 players instead of 5
node scripts/seed-data.js --demo --password 'Secret123!'
node scripts/seed-data.js --demo --balance 50000   # starting INR per player
```

---

## Logging in

Setup prints these when it finishes. Both go through the gateway on port 4000.

**Staff** — `POST /api/v1/admin/auth/login`

```json
{ "email": "admin@ibitplay.local", "password": "ChangeMe!2026" }
```

**Players** — `POST /api/v1/user/auth/login`. Note the field is `identifier`,
not `username`:

```json
{ "identifier": "demo_player01", "password": "Demo@12345" }
```

With `--demo` you also get `supermaster@`, `master@`, `agent@` and
`executive@demo.local`, one per role level, sharing one password — because most
of what goes wrong in a permissions surface goes wrong for somebody who is *not*
the owner, and a tree with only a superadmin in it cannot exercise a single
scoped query.

**Accounts that already exist are never given a new password.** Re-running the
demo dataset will not hand the printed password back to an account somebody has
since changed.

---

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

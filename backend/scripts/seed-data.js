#!/usr/bin/env node
'use strict';

/**
 * The data runner — everything the platform needs in its tables, on demand.
 *
 *   node scripts/seed-data.js                    platform configuration
 *   node scripts/seed-data.js --demo             …and the full demo cast (staff tree, players, money)
 *   node scripts/seed-data.js --only sports,rates
 *   node scripts/seed-data.js --demo --skip bootstrap
 *   node scripts/seed-data.js --list             what each dataset writes
 *   node scripts/seed-data.js --reset-demo       what a reset would delete (dry run)
 *   node scripts/seed-data.js --reset-demo --yes delete every demo_ account and its rows
 *   node scripts/seed-data.js --demo --history   …and 90 days of backdated activity for the charts
 *   node scripts/seed-data.js --history 30       the same, on a database already seeded with --demo
 *                                                (its VIP lump stays a spike on seed day; see docs/SETUP.md)
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT ANOTHER FILE IN `packages/db/seeders/`
 *
 * Those run through Umzug, which records each one in `sequelize_seed_meta` and
 * then never runs it again. That is exactly right for the two that are there —
 * the role ladder and the bootstrap super-admin are a one-time break in a
 * circular dependency, and re-running them against a live database would be a
 * way to hand the default admin password back to an attacker.
 *
 * It is exactly wrong for configuration. `siteconfig`, the sports catalogue,
 * the spin wheel and the exchange rates are rows an operator edits, that a
 * developer wants to reset, and that a new environment needs filled again after
 * someone truncates a table. A tracked seeder answers "already ran" and does
 * nothing, which is the least useful possible response to `db:seed:data`.
 *
 * So: every dataset below is IDEMPOTENT and re-runnable. Each one checks for
 * what it is about to write and adds only what is missing — running this twice
 * changes nothing the second time, and running it against a database somebody
 * has been using does not overwrite their edits.
 *
 * ── THE TWO GROUPS ───────────────────────────────────────────────────────
 *
 *   config   Rows the platform does not work correctly without. Safe anywhere.
 *   demo     Fake staff, fake players, fake money and content. Refuses to run
 *            when NODE_ENV=production without --force, because these are real,
 *            working accounts.
 *
 * ── THE DEMO CAST ────────────────────────────────────────────────────────
 *
 * Every demo account's username AND email start with `demo_`, so it is
 * obviously fake and `--reset-demo` can find exactly it and nothing else.
 *
 * Passwords are RANDOM PER ACCOUNT, generated when the account is created and
 * written only to `backend/.demo-credentials.local.md` (gitignored, mode 0600;
 * `DEMO_CREDENTIALS_FILE` moves it). They are never printed. A re-run never
 * rotates a password: an existing account is left alone and only new accounts
 * are appended to the file.
 *
 * Demo MONEY moves through the real services (see scripts/lib/demo-services.js)
 * so every demo wallet reconciles against its own ledger, exactly like a real
 * player's: deposits through the fiat deposit service, tips through
 * TipService, bonuses through PlayerBonusService, the vault through
 * VaultService, VIP/rakeback/affiliate commission through the wager feed, and
 * agent-tree players funded from their agent's float through LordsService.
 * No demo dataset places a bet.
 *
 * `--history [days]` (scripts/lib/demo-history.js) adds the PAST: extra
 * `demo_h…` players and N days of deposits, play, tips, vault, bonuses and
 * withdrawals through the same services, then backdates exactly the rows that
 * run wrote (demo players' rows only) so the admin charts have a curve. It
 * never calls a provider: rounds and bets are ledger movements plus the
 * provider-side record, written locally.
 * ═════════════════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const path = require('path');

const { hashPassword } = require('@ibitplay/auth');
const { loadEnv, dbEnvShape, coercers, createLogger, money, featureCatalogue, resolveVipLadder } = require('@ibitplay/common');
const { createSequelize, authenticate } = require('@ibitplay/db/src/sequelize');
const { createMigrator } = require('@ibitplay/db/src/migrator');
const { QueryTypes } = require('sequelize');

const { createCredentialsBook, credentialsPath, generatePassword, removeRowsFor, dbLabelOf } = require('./lib/demo-credentials');
const { DEFAULT_HISTORY_DAYS, MAX_HISTORY_DAYS, DEFAULT_HISTORY_SEED } = require('./lib/demo-history');

const ROOT = path.resolve(__dirname, '..');

/**
 * The sport ids, taken from the sportsbook rather than copied.
 *
 * The sportsbook is mssports (services/sports); its sport list is
 * `lib/constants/sportsList.mjs` — the feed's sport id (`sid` / `etid`) and
 * name. `mssports.sports_config.game_id` is compared against that id, so a copy
 * here that drifted would produce rows for sports the board can never match.
 */
const { SPORTS_LIST } = require(path.join(ROOT, 'services/sports/src/lib/constants/sportsList.mjs'));
const SPORT_NAMES = Object.fromEntries(SPORTS_LIST);

// ══════════════════════════════════════════════════════════════════════════
//  Output
// ══════════════════════════════════════════════════════════════════════════

const TTY = process.stdout.isTTY;
const c = (code) => (text) => (TTY ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const bold = c('1');
const dim = c('2');
const red = c('31');
const green = c('32');
const yellow = c('33');
const blue = c('34');
const cyan = c('36');

const say = (message = '') => process.stdout.write(`${message}\n`);

// ══════════════════════════════════════════════════════════════════════════
//  Arguments
// ══════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = {
    demo: false,
    only: null,
    skip: [],
    list: false,
    force: false,
    resetDemo: false,
    yes: false,
    players: 6,
    balance: '10000',
    history: null,
    historySeed: DEFAULT_HISTORY_SEED,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    const names = () => String(next() || '').split(',').map((s) => s.trim()).filter(Boolean);

    switch (arg) {
      case '--demo': args.demo = true; break;
      case '--all': args.demo = true; break;
      case '--list': args.list = true; break;
      case '--force': args.force = true; break;
      case '--only': args.only = names(); break;
      case '--skip': args.skip = names(); break;
      case '--reset-demo': args.resetDemo = true; break;
      case '--yes': args.yes = true; break;
      case '--players': args.players = Math.max(0, Math.min(200, Number(next()) || 0)); break;
      case '--balance': args.balance = String(next() || args.balance); break;
      case '--history': {
        // `--history` alone means the default span; `--history 30` sets it.
        const value = argv[i + 1];
        if (value !== undefined && /^-?\d+$/.test(value)) {
          i += 1;
          args.history = Number(value);
        } else {
          args.history = DEFAULT_HISTORY_DAYS;
        }
        if (!Number.isInteger(args.history) || args.history < 1 || args.history > MAX_HISTORY_DAYS) {
          say(`${red('--history')} takes a number of days from 1 to ${MAX_HISTORY_DAYS} (got "${value}")`);
          process.exit(1);
        }
        break;
      }
      case '--history-seed': {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 0) {
          say(`${red('--history-seed')} must be a non-negative integer`);
          process.exit(1);
        }
        args.historySeed = value;
        break;
      }
      case '--password':
        // Removed on purpose: one shared, printed password for every demo
        // account is what the per-account credentials file replaces.
        say(`${red('--password is no longer supported.')} Every demo account gets its own random password,`);
        say(`written to ${credentialsPath()} (never printed).`);
        process.exit(1);
        break;
      case '--help':
      case '-h':
        args.list = true;
        break;
      default:
        if (arg.startsWith('-')) {
          say(`${red('Unknown flag')} ${arg}`);
          process.exit(1);
        }
    }
  }

  if (!/^\d+(\.\d{1,8})?$/.test(args.balance) || !money.gt(args.balance, '0')) {
    say(`${red('--balance')} must be a positive decimal (got "${args.balance}")`);
    process.exit(1);
  }

  return args;
}

const args = parseArgs(process.argv);

// ══════════════════════════════════════════════════════════════════════════
//  Small SQL helpers
// ══════════════════════════════════════════════════════════════════════════

const select = (sequelize, sql, replacements, transaction) =>
  sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });

const one = async (...callArgs) => (await select(...callArgs))[0] ?? null;

const exec = (sequelize, sql, replacements, transaction) =>
  sequelize.query(sql, { replacements, transaction });

/**
 * An insert that may hit ON CONFLICT DO NOTHING — did it write a row?
 *
 * Read from `RETURNING id` rather than from the metadata Sequelize hands back:
 * what that second element holds is dialect-dependent and changes between
 * query types, whereas an empty RETURNING is the same answer everywhere.
 */
const insertedRow = async (sequelize, sql, replacements, transaction) =>
  (await select(sequelize, sql, replacements, transaction))[0] ?? null;

/** The columns `table` has on this database — for datasets that fill columns newer migrations add. */
async function columnsOf(sequelize, table, transaction) {
  const rows = await select(
    sequelize,
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table`,
    { table },
    transaction
  );
  return new Set(rows.map((r) => r.column_name));
}

// ══════════════════════════════════════════════════════════════════════════
//  The datasets
// ══════════════════════════════════════════════════════════════════════════

/**
 * A dataset is `{ name, group, description, run }`.
 *
 * `run` gets `{ sequelize, transaction, config, logger, report, credentials,
 * results, services }` and calls `report(...)` for each thing it wrote. Every
 * one runs inside its own transaction, so a dataset that fails leaves the ones
 * before it in place and the run continues — the alternative is one bad row
 * rolling back a full seed.
 *
 * `ownTransaction: false` opts out: `bootstrap` (Umzug has its own), and every
 * dataset that moves money through the services — those commit each movement
 * in the service's own transaction, exactly as in production, and are
 * idempotent step by step instead (ledger idempotency keys, tip request ids,
 * bonus grant keys, wager `(source, ref)`), so a half-finished run is finished
 * by the next one.
 *
 * `report(kind, message)`: kind `created` (or any verb) for a write, `exists` /
 * `skipped` for nothing-to-do, `warn` for something the operator should know.
 */
const DATASETS = [];

// ── bootstrap ────────────────────────────────────────────────────────────

DATASETS.push({
  name: 'bootstrap',
  group: 'config',
  ownTransaction: false,
  description: 'The tracked seeders — 7 roles, the super-admin, the in-house game catalogue',
  async run({ sequelize, logger, report }) {
    // Delegating rather than duplicating. `001-roles-and-admin` is the file
    // that decides what a Super Admin is and refuses to reset an existing
    // password; a second copy of that logic here is a second thing to get
    // wrong, and the two would disagree the first time either changed.
    const { seeders } = createMigrator({ sequelize, logger });
    const pending = await seeders.pending();

    if (!pending.length) {
      report('already applied', `${(await seeders.executed()).length} seeder(s)`);
      return;
    }

    const applied = await seeders.up();
    for (const seeder of applied) report('ran', seeder.name);
  },
});

// ── siteconfig ───────────────────────────────────────────────────────────

/**
 * Starter first-deposit bonus tiers, in the reward currency (operator-entered
 * amounts — see the reward-currency skill). Written only where the list is
 * still the schema's empty default; the switch itself is left OFF, because
 * turning on a bonus that pays real money is the operator's decision.
 */
const STARTER_FIRST_DEPOSIT_TIERS = [
  { minDeposit: '10', percent: '100', maxBonus: '100' },
  { minDeposit: '100', percent: '50', maxBonus: '500' },
  { minDeposit: '1000', percent: '25', maxBonus: '1000' },
];

/** Columns newer migrations added, with the value a NULL one is filled with. */
const SITECONFIG_FILL = [
  // Migration 081 — tip limits, USD. "0" switches a limit off; NULL is "never set".
  ['tip_max_per_tip_usd', '500'],
  ['tip_max_per_day_usd', '2000'],
  ['tip_min_wagered_usd', '0'],
  // Migration 076 — days an unwagered first-deposit bonus stays in the bonus balance.
  ['first_deposit_bonus_expiry_days', '30'],
];

DATASETS.push({
  name: 'siteconfig',
  group: 'config',
  description: 'The single settings row: flags at their defaults, tip limits, starter first-deposit tiers',
  async run({ sequelize, transaction, report }) {
    /**
     * ONE row, and only one.
     *
     * Migration 021 put a `((true))` unique index on this table precisely
     * because every reader was `SELECT … LIMIT 1` with no ORDER BY. Inserting a
     * second row here would either be refused by that index or — on a database
     * where 021 skipped it — reintroduce the bug it was written to close.
     *
     * `registerbonus` is the only NOT NULL column without a default. Everything
     * else takes the schema's defaults, which are the flags-on state the admin
     * panel expects an unconfigured deployment to be in.
     */
    let row = await one(sequelize, 'SELECT id FROM siteconfig LIMIT 1', {}, transaction);

    if (row) {
      report('exists', `siteconfig row (id ${row.id})`);
    } else {
      row = await one(
        sequelize,
        `INSERT INTO siteconfig (registerbonus, createdat, updatedat)
         VALUES (:registerbonus, now(), now())
         RETURNING id`,
        { registerbonus: process.env.SEED_REGISTER_BONUS || '0' },
        transaction
      );
      report('created', `siteconfig row (id ${row.id}) — every flag at its schema default`);
    }

    // Fill — never overwrite. A column an operator set (even to 0) is left alone.
    const columns = await columnsOf(sequelize, 'siteconfig', transaction);
    const filled = [];
    for (const [column, value] of SITECONFIG_FILL) {
      if (!columns.has(column)) continue;
      // `column` comes from the constant list above, never from input.
      const done = await insertedRow(
        sequelize,
        `UPDATE siteconfig SET ${column} = :value, updatedat = now() WHERE id = :id AND ${column} IS NULL RETURNING id`,
        { id: row.id, value },
        transaction
      );
      if (done) filled.push(`${column}=${value}`);
    }

    if (columns.has('first_deposit_bonus_tiers')) {
      const done = await insertedRow(
        sequelize,
        `UPDATE siteconfig
            SET first_deposit_bonus_tiers = CAST(:tiers AS jsonb), updatedat = now()
          WHERE id = :id
            AND COALESCE(first_deposit_bonus_tiers, '[]'::jsonb) = '[]'::jsonb
            AND COALESCE(first_deposit_bonus_enabled, false) = false
          RETURNING id`,
        { id: row.id, tiers: JSON.stringify(STARTER_FIRST_DEPOSIT_TIERS) },
        transaction
      );
      if (done) {
        filled.push(`${STARTER_FIRST_DEPOSIT_TIERS.length} first-deposit tiers`);
        report('warn', 'First-deposit tiers are stored but the bonus stays OFF — switch it on in Site config → Welcome bonuses.');
      }
    }

    if (filled.length) report('filled', filled.join(', '));
    else report('exists', 'tip limits and bonus tiers already set — not overwritten');
  },
});

// ── sports catalogue ─────────────────────────────────────────────────────

/**
 * Which sports a fresh deployment shows.
 *
 * `mssports.sports_config.enabled` is the operator's switch for which sports the
 * sportsbook's back-office config lists (buffers, commission). Three on by
 * default because that is what the board actually trades; the rest are
 * catalogued and switched off.
 */
const DEFAULT_ENABLED_SPORTS = [4, 1, 2]; // Cricket, Football, Tennis

DATASETS.push({
  name: 'sports',
  group: 'config',
  description: `The ${Object.keys(SPORT_NAMES).length} sports the feed knows, with cricket/soccer/tennis enabled`,
  async run({ sequelize, transaction, report }) {
    const enabledIds = new Set(
      (process.env.SEED_ENABLED_SPORTS
        ? process.env.SEED_ENABLED_SPORTS.split(',').map((s) => Number(s.trim()))
        : DEFAULT_ENABLED_SPORTS
      ).filter(Number.isFinite)
    );

    let added = 0;
    let present = 0;

    for (const [gameId, gameName] of Object.entries(SPORT_NAMES)) {
      // `game_id` has no unique constraint — legacy inserted without checking
      // and the catalogue service does this same SELECT-then-INSERT for the
      // same reason. ON CONFLICT is not available without the index.
      const existing = await one(
        sequelize,
        'SELECT id FROM mssports.sports_config WHERE game_id = :gameId LIMIT 1',
        { gameId: Number(gameId) },
        transaction
      );

      if (existing) {
        present += 1;
        continue;
      }

      await exec(
        sequelize,
        `INSERT INTO mssports.sports_config (game_id, game_name, enabled, created_at, updated_at)
         VALUES (:gameId, :gameName, :enabled, now(), now())`,
        { gameId: Number(gameId), gameName, enabled: enabledIds.has(Number(gameId)) },
        transaction
      );
      added += 1;
    }

    if (added) report('created', `${added} sport(s)`);
    if (present) report('exists', `${present} sport(s) already catalogued`);
    report('enabled', [...enabledIds].map((id) => SPORT_NAMES[id] || id).join(', '));
  },
});

// ── spin wheel ───────────────────────────────────────────────────────────

/**
 * The wheel.
 *
 * Weighted, and one slice is bad luck. A wheel where every slice pays is not a
 * wheel, and `spinWheel.validators` refuses a slice set whose weights are all
 * zero — so the weights below are the shape the service expects, not
 * decoration.
 */
const SPIN_SLICES = [
  { label: '5%', reward_pct: '5.00', color: '#22c55e', weight: 22, is_bad_luck: false },
  { label: '10%', reward_pct: '10.00', color: '#3b82f6', weight: 18, is_bad_luck: false },
  { label: 'Better luck', reward_pct: '0.00', color: '#64748b', weight: 16, is_bad_luck: true },
  { label: '15%', reward_pct: '15.00', color: '#a855f7', weight: 14, is_bad_luck: false },
  { label: '20%', reward_pct: '20.00', color: '#f59e0b', weight: 12, is_bad_luck: false },
  { label: 'Better luck', reward_pct: '0.00', color: '#475569', weight: 10, is_bad_luck: true },
  { label: '35%', reward_pct: '35.00', color: '#ec4899', weight: 6, is_bad_luck: false },
  { label: '50%', reward_pct: '50.00', color: '#ef4444', weight: 2, is_bad_luck: false },
];

DATASETS.push({
  name: 'spinwheel',
  group: 'config',
  description: 'Deposit-spin config and 8 weighted slices',
  async run({ sequelize, transaction, report }) {
    const config = await one(sequelize, 'SELECT id FROM spin_wheel_config LIMIT 1', {}, transaction);

    if (config) {
      report('exists', `spin wheel config (id ${config.id})`);
    } else {
      const row = await one(
        sequelize,
        `INSERT INTO spin_wheel_config (min_deposit, reward_pct, claim_cooldown_days, is_active)
         VALUES (100, 5.00, 7, true)
         RETURNING id`,
        {},
        transaction
      );
      report('created', `spin wheel config (id ${row.id}) — 100 minimum deposit, 7-day cooldown`);
    }

    const [{ count }] = await select(
      sequelize,
      'SELECT COUNT(*)::int AS count FROM spin_wheel_slices',
      {},
      transaction
    );

    if (count > 0) {
      // Never merged into an existing wheel. Slice weights are relative, so
      // adding eight more to a wheel an operator has tuned silently halves
      // every probability they set.
      report('exists', `${count} slice(s) — left alone`);
      return;
    }

    for (const [index, slice] of SPIN_SLICES.entries()) {
      await exec(
        sequelize,
        `INSERT INTO spin_wheel_slices (label, reward_pct, color, sort_order, is_bad_luck, weight)
         VALUES (:label, :reward_pct, :color, :sort_order, :is_bad_luck, :weight)`,
        { ...slice, sort_order: index },
        transaction
      );
    }

    report('created', `${SPIN_SLICES.length} slices (${SPIN_SLICES.filter((s) => s.is_bad_luck).length} bad luck)`);
  },
});

// ── exchange rates ───────────────────────────────────────────────────────

/**
 * Starter rates, as USD per one unit.
 *
 * ONLY A STARTING POINT. `ExchangeRateService.convert` routes every swap
 * through these numbers, so a stale rate is a mispriced trade — the operator's
 * job is to keep them current through the admin endpoints or a feed. They exist
 * here because the alternative on a fresh database is `RATE_NOT_FOUND` on every
 * conversion, which looks like a broken feature rather than an unconfigured one.
 *
 * Existing rows are NEVER overwritten, for the same reason.
 */
const STARTER_RATES = [
  ['USDT', '1.00000000'], ['USDC', '1.00000000'], ['BUSD', '1.00000000'],
  ['TUSD', '1.00000000'], ['USDP', '1.00000000'],
  ['BTC', '65000.00000000'], ['ETH', '3200.00000000'], ['LTC', '80.00000000'],
  ['BCH', '400.00000000'], ['BNB', '580.00000000'], ['XRP', '0.52000000'],
  ['ADA', '0.45000000'], ['TRX', '0.12000000'], ['DOGE', '0.13000000'],
  ['MATIC', '0.55000000'], ['SHIB', '0.00002000'], ['NEXO', '1.10000000'],
  ['MKR', '2400.00000000'],
  ['INR', '0.01200000'], ['AED', '0.27000000'], ['PKR', '0.00360000'],
  ['NPR', '0.00750000'], ['BDT', '0.00840000'], ['MVR', '0.06500000'],
  ['EUR', '1.08000000'],
];

DATASETS.push({
  name: 'rates',
  group: 'config',
  description: `Starter exchange rates for ${STARTER_RATES.length} currencies (placeholder values)`,
  async run({ sequelize, transaction, report }) {
    let added = 0;
    let present = 0;

    for (const [currency, usdRate] of STARTER_RATES) {
      // `exchangerate` has no unique index on `currency`, and the service
      // compares it case-insensitively — so the check has to as well, or a
      // second run adds `usdt` beside `USDT` and `#findRate` picks one at random.
      const existing = await one(
        sequelize,
        'SELECT id FROM exchangerate WHERE UPPER(currency) = :currency LIMIT 1',
        { currency },
        transaction
      );

      if (existing) {
        present += 1;
        continue;
      }

      await exec(
        sequelize,
        `INSERT INTO exchangerate (currency, usd_rate, last_updated)
         VALUES (:currency, :usdRate, CURRENT_TIMESTAMP)`,
        { currency, usdRate },
        transaction
      );
      added += 1;
    }

    if (added) report('created', `${added} rate(s)`);
    if (present) report('exists', `${present} rate(s) already set — not overwritten`);
    if (added) report('warn', 'These are PLACEHOLDER rates. Update them before anyone swaps real money.');
  },
});

// ── the in-house game catalogue ──────────────────────────────────────────

/**
 * The twenty in-house games, as `js_games` catalogue rows.
 *
 * Seeder `002-inhouse-games` registers four. `inHouse.constants.GAMES` lists
 * twenty, and those strings are what `bets.game` carries for every round the
 * platform settles itself — so the other sixteen are games the bet-history
 * screens can show a bet for and cannot name, because the join to `js_games`
 * finds nothing.
 *
 * Taken from the service's own constant so the two cannot drift.
 */
const IN_HOUSE_TITLES = {
  crash: 'Crash', classic_dice: 'Classic Dice', hash_dice: 'Hash Dice', limbo: 'Limbo',
  keno: 'Keno', single_keno: 'Single Keno', hilo: 'Hi-Lo', highlow: 'High Low',
  wheel: 'Wheel', magic_wheel: 'Magic Wheel', plinko: 'Plinko', mine: 'Mines',
  tower: 'Tower', diamond: 'Diamonds', goal: 'Goal', roulette: 'Roulette',
  blackjack: 'Blackjack', videopoker: 'Video Poker', three_card_monte: 'Three Card Monte',
  snake_and_ladders: 'Snakes and Ladders',
};

DATASETS.push({
  name: 'games',
  group: 'config',
  description: 'All 20 in-house games in the js_games catalogue',
  async run({ sequelize, transaction, report }) {
    const { GAMES } = require(path.join(ROOT, 'services/casino/src/modules/in-house/inHouse.constants.js'));

    let added = 0;
    let present = 0;

    for (const uid of GAMES) {
      // `js_games_game_uid_key` is a real unique constraint, so this one can
      // use ON CONFLICT — and DO NOTHING rather than DO UPDATE, because an
      // operator may have renamed a game or pointed it at an icon.
      const row = await insertedRow(
        sequelize,
        `INSERT INTO js_games (game_name, game_uid, game_type, is_active, vendor, created_at, updated_at)
         VALUES (:name, :uid, :type, true, 'in-house', now(), now())
         ON CONFLICT (game_uid) DO NOTHING
         RETURNING id`,
        { name: IN_HOUSE_TITLES[uid] || uid, uid, type: uid },
        transaction
      );

      if (row) added += 1;
      else present += 1;
    }

    if (added) report('created', `${added} in-house game(s)`);
    if (present) report('exists', `${present} in-house game(s) already catalogued`);
  },
});

// ── vault lock terms ─────────────────────────────────────────────────────

/**
 * The vault's lock terms — the same four `seeders/003-vault-lock-terms` writes.
 *
 * That seeder is tracked, so it runs once per database and never again: a
 * table somebody emptied stays empty, and the vault answers
 * `LOCK_PERIOD_NOT_FOUND` to every deposit. This puts back only the terms
 * that are missing (`lock_period` is UNIQUE); a term an operator edited is
 * left exactly as it is.
 */
const VAULT_TERMS = [
  { lock_period: 'flexible', label: 'Flexible', days: 0, rate: '1.0000', early_penalty_rate: '0' },
  { lock_period: '7d', label: '7 Days', days: 7, rate: '3.5000', early_penalty_rate: '0' },
  { lock_period: '30d', label: '30 Days', days: 30, rate: '7.5000', early_penalty_rate: '5' },
  { lock_period: '90d', label: '90 Days', days: 90, rate: '12.0000', early_penalty_rate: '8' },
];

DATASETS.push({
  name: 'vaultterms',
  group: 'config',
  description: `The ${VAULT_TERMS.length} vault lock terms (flexible, 7d, 30d, 90d) where missing`,
  async run({ sequelize, transaction, report }) {
    const columns = await columnsOf(sequelize, 'vault_lock_rates', transaction);
    const withPenalty = columns.has('early_penalty_rate');
    let added = 0;
    let present = 0;

    for (const term of VAULT_TERMS) {
      const row = await insertedRow(
        sequelize,
        `INSERT INTO vault_lock_rates (lock_period, label, days, rate, ${withPenalty ? 'early_penalty_rate, ' : ''}is_active, "createdAt", "updatedAt")
         VALUES (:lock_period, :label, :days, :rate, ${withPenalty ? ':early_penalty_rate, ' : ''}true, now(), now())
         ON CONFLICT (lock_period) DO NOTHING
         RETURNING id`,
        term,
        transaction
      );
      if (row) added += 1;
      else present += 1;
    }

    if (added) report('created', `${added} vault term(s)`);
    if (present) report('exists', `${present} vault term(s) already configured — not overwritten`);
  },
});

// ── site features ────────────────────────────────────────────────────────

/**
 * One `site_features` row per catalogue feature, where the row is missing.
 *
 * The player site gates every section on `/admin/features/public`, which
 * lists a feature only when its row is enabled with a real variant
 * (`frontend/src/lib/siteGates.ts` GATES). A database whose admin-service has
 * never booted with `SITE_TEMPLATE` (or whose owner panel has never pushed a
 * plan) has NO rows — so the gift cards, swap, vault, tips, bonus, VIP,
 * affiliate, promotions, tournaments and blog pages all answer "Not available
 * on this site", and nothing explains why.
 *
 * Variants follow the Carbon Gold template (this site's `SITE_TEMPLATE=stake`)
 * where it names one; every feature the frontend gates on is switched on.
 * Features that need integration keys to work (push notifications, analytics)
 * get a row that is OFF. The four policies take their catalogue defaults —
 * `reward_currency` USDT (the reward-currency skill's default).
 *
 * NEVER overwrites: an existing row is the owner's or the operator's. The
 * `_template` row is not written either, so a boot-time `SITE_TEMPLATE` (or
 * the owner panel) still applies its full plan over these rows.
 */
const FEATURE_TEMPLATE = 'carbon_gold';
const FEATURES_ALWAYS_ON = [
  'gift_cards', 'swap', 'vault', 'tips', 'bonus', 'vip', 'affiliate', 'promotions', 'races', 'blog',
  'spin_wheel', 'notifications', 'kyc',
];
const FEATURES_NEED_KEYS = ['push_notifications', 'analytics'];

function seedFeatureRow(feature) {
  const { TEMPLATES, defaultVariantOf, isPolicy } = featureCatalogue;
  if (isPolicy(feature.key)) return { enabled: true, variant: defaultVariantOf(feature.key) };
  const real = (feature.variants ?? []).map((v) => v.key).filter((key) => key !== 'none');
  if (FEATURES_NEED_KEYS.includes(feature.key) || !real.length) return { enabled: false, variant: 'none' };
  const fromTemplate = TEMPLATES[FEATURE_TEMPLATE]?.variants?.[feature.key];
  if (fromTemplate && fromTemplate !== 'none') return { enabled: true, variant: fromTemplate };
  if (FEATURES_ALWAYS_ON.includes(feature.key)) return { enabled: true, variant: real[0] };
  return { enabled: false, variant: 'none' };
}

DATASETS.push({
  name: 'features',
  group: 'config',
  description: 'site_features rows for every catalogue feature + the 4 policies (reward currency USDT), only where missing',
  async run({ sequelize, transaction, report }) {
    const on = [];
    const off = [];
    let present = 0;

    for (const feature of featureCatalogue.FEATURES) {
      const { enabled, variant } = seedFeatureRow(feature);
      const row = await insertedRow(
        sequelize,
        `INSERT INTO site_features (feature, enabled, variant, config, secrets, updated_by, created_at, updated_at)
         VALUES (:feature, :enabled, :variant, '{}'::jsonb, '{}'::jsonb, 'seed-data', now(), now())
         ON CONFLICT (feature) DO NOTHING
         RETURNING feature`,
        { feature: feature.key, enabled, variant },
        transaction
      );
      if (!row) present += 1;
      else if (enabled) on.push(`${feature.key}=${variant}`);
      else off.push(feature.key);
    }

    if (on.length) report('created', `${on.length} feature row(s) on: ${on.join(', ')}`);
    if (off.length) report('created', `${off.length} feature row(s) off: ${off.join(', ')}`);
    if (present) report('exists', `${present} feature row(s) already set — not overwritten`);
    if (off.some((key) => FEATURES_NEED_KEYS.includes(key))) {
      report('warn', 'Push notifications / analytics stay OFF until their keys are entered in Site config → Features.');
    }
  },
});

// ══════════════════════════════════════════════════════════════════════════
//  Demo data
// ══════════════════════════════════════════════════════════════════════════

const DEMO_EMAIL_DOMAIN = 'demo.local';
const demoEmail = (name) => `${name}@${DEMO_EMAIL_DOMAIN}`;

/** `wager_activity.source` for demo turnover — counted like a stake, but no bet exists. */
const DEMO_WAGER_SOURCE = 'demo_seed';

/** A stable v5-shaped UUID from a seed string — tip `requestId`s that make a re-run a replay. */
function stableUuid(seed) {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const ledgerKeyExists = async (sequelize, key) =>
  Boolean(await one(sequelize, 'SELECT id FROM credits_ledger WHERE idempotency_key = :key LIMIT 1', { key }));

/** "Demo Vip Gold" from "demo_vip_gold" — KYC and payout names. */
const displayName = (name) =>
  name.replace(/^demo_/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// ── staff ────────────────────────────────────────────────────────────────

/**
 * The staff tree: one account per rung of the role ladder, two agents.
 *
 *   demo_superadmin          Super Admin (a second, demo-only owner account)
 *   └ demo_admin             Admin
 *     ├ demo_executive       Executive (read-only support, acts with Admin's level)
 *     └ demo_subadmin        Sub Admin
 *       └ demo_supermaster   Super Master
 *         └ demo_master      Master
 *           ├ demo_agent     Agent — float 100k INR, credit limit 50k
 *           └ demo_agent2    Agent — float 100k INR, credit limit 50k
 *
 * Most of what goes wrong in an RBAC surface goes wrong for somebody who is
 * NOT the owner, so every scoped query has someone to be scoped to.
 *
 * Roles are resolved from the ladder `seeders/001-roles-and-admin` defines
 * (by id, then by name, at that seeder's level) — a database whose ladder is
 * incomplete gets the missing rung added, never an existing role changed.
 *
 * `legacyEmail`: the address the previous version of this dataset used, so a
 * database seeded by it is recognised instead of getting a second account.
 */
const DEMO_STAFF = [
  { name: 'demo_superadmin', role: 'Super Admin', parent: null, percentage: 0, float: '0', note: 'super-admin equivalent (demo only)' },
  { name: 'demo_admin', role: 'Admin', parent: 'demo_superadmin', percentage: 0, float: '1000000', note: 'handles the demo deposit/withdrawal queues' },
  { name: 'demo_executive', role: 'Executive', parent: 'demo_admin', percentage: 0, float: '0', legacyEmail: 'executive@demo.local', noTransactionPassword: true, note: 'read-only support under demo_admin' },
  { name: 'demo_subadmin', role: 'Sub Admin', parent: 'demo_admin', percentage: 0, float: '500000' },
  { name: 'demo_supermaster', role: 'Super Master', parent: 'demo_subadmin', percentage: 10, float: '300000', legacyEmail: 'supermaster@demo.local' },
  { name: 'demo_master', role: 'Master', parent: 'demo_supermaster', percentage: 8, float: '200000', legacyEmail: 'master@demo.local' },
  { name: 'demo_agent', role: 'Agent', parent: 'demo_master', percentage: 5, float: '100000', creditLimit: '50000', legacyEmail: 'agent@demo.local', note: 'owns the odd demo_playerNN' },
  { name: 'demo_agent2', role: 'Agent', parent: 'demo_master', percentage: 5, float: '100000', creditLimit: '50000', note: 'owns the even demo_playerNN' },
];

const AGENT_NAMES = DEMO_STAFF.filter((s) => s.role === 'Agent').map((s) => s.name);

async function ensureRole(sequelize, transaction, role, report) {
  const byId = await one(sequelize, 'SELECT id FROM roles WHERE id = :id AND level = :level', role, transaction);
  if (byId) return Number(byId.id);

  const byName = await one(sequelize, 'SELECT id, level FROM roles WHERE name = :name', role, transaction);
  if (byName && Number(byName.level) === role.level) return Number(byName.id);
  if (byName) {
    throw new Error(
      `Role "${role.name}" exists at level ${byName.level}, not ${role.level} — repair the roles table (seeder 001) before seeding demo staff`
    );
  }

  // The ladder's own id when it is free; otherwise the next free one.
  const idTaken = await one(sequelize, 'SELECT id FROM roles WHERE id = :id', role, transaction);
  const row = await one(
    sequelize,
    `INSERT INTO roles (id, name, level, responsibilities)
     VALUES (${idTaken ? '(SELECT MAX(id) + 1 FROM roles)' : ':id'}, :name, :level, :responsibilities)
     RETURNING id`,
    role,
    transaction
  );
  await exec(sequelize, "SELECT setval(pg_get_serial_sequence('roles', 'id'), GREATEST((SELECT MAX(id) FROM roles), 1))", {}, transaction);
  report('created', `role "${role.name}" (level ${role.level}, id ${row.id}) — missing from the ladder`);
  return Number(row.id);
}

DATASETS.push({
  name: 'staff',
  group: 'demo',
  description: 'Staff tree: super-admin → admin (+ executive) → sub-admin → super-master → master → 2 agents, with floats',
  async run({ sequelize, transaction, config, report, credentials }) {
    const { ROLES } = require(path.join(ROOT, 'packages/db/seeders/001-roles-and-admin.js'));
    const roleIds = new Map();
    for (const role of ROLES) roleIds.set(role.name, await ensureRole(sequelize, transaction, role, report));

    const staffColumns = await columnsOf(sequelize, 'staff', transaction);
    const byName = new Map();
    const transactionPasswords = {};
    let added = 0;
    let present = 0;

    for (const person of DEMO_STAFF) {
      const email = demoEmail(person.name);
      const existing = await one(
        sequelize,
        'SELECT id FROM staff WHERE name = :name OR email IN (:emails) ORDER BY id ASC LIMIT 1',
        { name: person.name, emails: [email, person.legacyEmail ?? email] },
        transaction
      );

      if (existing) {
        // Never re-hashed: that would be a password reset on an account
        // somebody may be signed into, and the credentials file would lie.
        byName.set(person.name, Number(existing.id));
        present += 1;
        continue;
      }

      const parentId = person.parent ? byName.get(person.parent) : null;
      if (person.parent && !parentId) throw new Error(`${person.name}: parent ${person.parent} was not created`);

      const password = generatePassword();
      const transactionPassword = person.noTransactionPassword ? null : generatePassword();

      // `must_change_password` / `updated_at` come from newer migrations.
      const extraColumns = ['must_change_password', 'updated_at'].filter((col) => staffColumns.has(col));
      const inserted = await one(
        sequelize,
        `INSERT INTO staff (name, email, password, role_id, parent_id, percentage, status, first_login,
                            transaction_password, created_at${extraColumns.map((col) => `, ${col}`).join('')})
         VALUES (:name, :email, :password, :roleId, :parentId, :percentage, 'active', false,
                 :transactionPassword, now()${extraColumns.map((col) => (col === 'updated_at' ? ', now()' : ', false')).join('')})
         RETURNING id`,
        {
          name: person.name,
          email,
          password: await hashPassword(password, config.BCRYPT_ROUNDS),
          roleId: roleIds.get(person.role),
          parentId,
          percentage: person.percentage,
          transactionPassword: transactionPassword ? await hashPassword(transactionPassword, config.BCRYPT_ROUNDS) : null,
        },
        transaction
      );
      const id = Number(inserted.id);
      byName.set(person.name, id);

      /**
       * The closure table, in the same transaction as the insert.
       *
       * Every ancestor of the parent becomes an ancestor of the new account one
       * level deeper, plus the self-row at depth 0. An account missing from
       * `staff_hierarchy` is invisible to every scoped query INCLUDING the one
       * that would find it — which is why `staff.service.create` writes these
       * inside its transaction, and why this does too.
       */
      await exec(
        sequelize,
        `INSERT INTO staff_hierarchy (ancestor_id, descendant_id, depth)
         SELECT ancestor_id, descendant_id, depth FROM (
           SELECT CAST(:id AS bigint) AS ancestor_id, CAST(:id AS bigint) AS descendant_id, 0 AS depth
           UNION ALL
           SELECT ancestor_id, CAST(:id AS bigint), depth + 1
             FROM staff_hierarchy
            WHERE descendant_id = :parentId
         ) AS rows
         ON CONFLICT (ancestor_id, descendant_id) DO NOTHING`,
        { id, parentId: parentId ?? -1 },
        transaction
      );

      // The float the staff money paths draw from (`staffFloat.js`): agents
      // may run down to −credit_limit when they fund a player.
      await exec(
        sequelize,
        `INSERT INTO staff_balances (staff_id, inr, credit_limit, exposure_limit, gt, casino_gt)
         VALUES (:id, :float, :creditLimit, :exposureLimit, 0, 0)
         ON CONFLICT (staff_id) DO NOTHING`,
        { id, float: person.float, creditLimit: person.creditLimit ?? '0', exposureLimit: person.float },
        transaction
      );

      if (transactionPassword) transactionPasswords[person.name] = transactionPassword;
      credentials.add({
        kind: 'staff',
        login: email,
        email,
        password,
        role: person.role,
        transactionPassword: transactionPassword ?? '',
        note: person.note ?? '',
      });
      added += 1;
      report('created', `${email} — ${person.role}${parentId ? `, under staff ${parentId}` : ' (root)'}`);
    }

    if (present) report('exists', `${present} staff account(s) already present — passwords untouched`);
    if (!added && !present) report('warn', 'No staff written');
    return { ids: Object.fromEntries(byName), transactionPasswords };
  },
});

// ── players: shared helpers ──────────────────────────────────────────────

/**
 * A demo player — created with a random password if missing, found if not.
 *
 * Ids are random ten-digit numbers, matching `AuthService.#allocateUserId`.
 * `users.id` has no sequence — it is a bigint the application allocates — so a
 * seeder that used `MAX(id) + 1` would produce accounts that look nothing like
 * the ones registration creates, and would collide the moment two ran at once.
 *
 * The wallet row starts at ZERO, like registration's: every unit of money in a
 * demo wallet arrives through a service and has a ledger row.
 */
async function ensurePlayer(ctx, { name, parentStaffId = null, exposureLimit = '0', country = 'IN', note = '' }) {
  const { sequelize, config, credentials } = ctx;
  const existing = await one(sequelize, 'SELECT id, referalcode FROM users WHERE name = :name LIMIT 1', { name });
  if (existing) return { id: Number(existing.id), name, referralCode: existing.referalcode, created: false };

  const password = generatePassword();
  const passwordHash = await hashPassword(password, config.BCRYPT_ROUNDS);
  const email = demoEmail(name);

  const { id, referralCode } = await sequelize.transaction(async (transaction) => {
    const userId = await allocateUserId(sequelize, transaction);
    const code = await uniqueReferralCode(sequelize, transaction);

    await exec(
      sequelize,
      `INSERT INTO users
         (id, name, email, password, role_id, status, bet_status, wallet, friends,
          referalcode, created, updated_at, country, wager_multiplier, exposure_limit, parent_staff_id)
       VALUES
         (:id, :name, :email, :password, 6, 'active', 'active', '{}'::json, 'Support,',
          :referral, now(), now(), :country, 3, :exposureLimit, :parentStaffId)`,
      { id: userId, name, email, password: passwordHash, referral: code, country, exposureLimit, parentStaffId },
      transaction
    );

    // `credits` is the balance row. A user without one is a user every wallet
    // read returns null for — registration creates it in the same
    // transaction, and so does this. At zero.
    await exec(sequelize, 'INSERT INTO credits (uid, inr) VALUES (:id, 0) ON CONFLICT (uid) DO NOTHING', { id: userId }, transaction);

    await exec(
      sequelize,
      `INSERT INTO userconfig (uid, email_notifications, push_notifications, theme, language, updatedat)
       VALUES (:id, true, true, 'dark', 'en', now())
       ON CONFLICT (uid) DO NOTHING`,
      { id: userId },
      transaction
    );

    return { id: userId, referralCode: code };
  });

  credentials.add({
    kind: parentStaffId ? 'player (agent tree)' : 'player',
    login: name,
    email,
    password,
    role: 'player',
    note,
  });
  return { id, name, referralCode, created: true };
}

/** A referral code nobody has: `DEMO` + six digits. */
async function uniqueReferralCode(sequelize, transaction) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `DEMO${crypto.randomInt(100_000, 999_999)}`;
    const taken = await one(sequelize, 'SELECT id FROM users WHERE referalcode = :code', { code }, transaction);
    if (!taken) return code;
  }
  throw new Error('Could not allocate a free referral code after 10 attempts');
}

/**
 * Money for a demo wallet from nowhere — the house's ADMIN_CREDIT, through
 * `WalletService.credit`, under a stable idempotency key so a re-run is a
 * replay. Only for balances no player-facing flow can produce here (crypto:
 * the deposit provider is off on a dev box; tip floats).
 */
async function fundDemo(svc, player, currency, amount, purpose = 'balance') {
  const { REASON } = require(path.join(ROOT, 'services/user/src/modules/wallet/wallet.constants'));
  const idempotencyKey = `demo-seed:fund:${player.name}:${currency}:${purpose}`;
  // The wallet replays a key only within 48 h of its row; after that the
  // unique index refuses it. A re-run days later must find it, not fail.
  if (await ledgerKeyExists(svc.connection.sequelize, idempotencyKey)) return false;
  const result = await svc.wallet.credit(
    {
      userId: player.id,
      currency,
      amount,
      reason: REASON.ADMIN_CREDIT,
      idempotencyKey,
      refType: 'DEMO_SEED',
      refId: player.name,
      description: `Demo seed — ${purpose}`,
    },
    { sourceService: 'seed-data', username: player.name }
  );
  return !result.replayed;
}

const KYC_REJECTION = 'The document photo is blurry and the edges are cut off — please upload a clear, uncropped scan.';

/** One `user_kyc` row in the given state, unless the player already has one. NotSubmitted = no row. */
async function ensureKyc(sequelize, player, status) {
  if (!status || status === 'NotSubmitted') return false;
  const row = await one(sequelize, 'SELECT id FROM user_kyc WHERE user_id = :uid LIMIT 1', { uid: String(player.id) });
  if (row) return false;
  const [first, ...rest] = displayName(player.name).split(' ');
  await exec(
    sequelize,
    `INSERT INTO user_kyc (user_id, first_name, last_name, gender, date_of_birth, address, city, country,
                           document_type, status, rejection_reason, created_at, updated_at)
     VALUES (:uid, :first, :last, 'other', '1990-01-15', '12 Demo Street', 'Mumbai', 'India',
             'id_card', :status, :reason, now(), now())`,
    {
      uid: String(player.id),
      first: `Demo ${first}`,
      last: rest.join(' ') || 'Player',
      status,
      reason: status === 'Rejected' ? KYC_REJECTION : null,
    }
  );
  return true;
}

// ── agent-tree players ───────────────────────────────────────────────────

DATASETS.push({
  name: 'players',
  group: 'demo',
  ownTransaction: false,
  description: 'Agent-tree players (--players, default 6) split across demo_agent/demo_agent2, funded from the agent float',
  async run(ctx) {
    const { sequelize, report, results, dbLabel } = ctx;
    if (!args.players) {
      report('skipped', '--players 0');
      return;
    }

    const agents = [];
    for (const name of AGENT_NAMES) {
      const row = await one(sequelize, 'SELECT id, email FROM staff WHERE name = :name LIMIT 1', { name });
      if (row) agents.push({ name, id: Number(row.id), email: row.email });
    }
    if (!agents.length) {
      report('warn', 'No demo agent found, so no agent-tree players — run the `staff` dataset too.');
      return;
    }

    const svc = await ctx.services();
    const { lookupTransactionPassword } = require('./lib/demo-credentials');
    let added = 0;
    let present = 0;
    let funded = 0;
    let fundedBefore = 0;
    const unfunded = [];

    for (let index = 1; index <= args.players; index += 1) {
      const agent = agents[(index - 1) % agents.length];
      const name = `demo_player${String(index).padStart(2, '0')}`;
      const player = await ensurePlayer(ctx, {
        name,
        parentStaffId: agent.id,
        exposureLimit: '100000',
        note: `agent-tree player of ${agent.name}`,
      });
      if (player.created) added += 1;
      else present += 1;

      // The opening balance is a TRANSFER from the agent's float (LordsService:
      // guarded float debit, player credit, staff_transfers + TRANSFER_IN
      // ledger) — an agent-tree player's money only ever comes from the agent.
      const key = `demo-seed:agent-fund:${name}`;
      if (await ledgerKeyExists(sequelize, key)) {
        fundedBefore += 1;
        continue;
      }
      const transactionPassword =
        results.staff?.transactionPasswords?.[agent.name] ?? lookupTransactionPassword(dbLabel, agent.email);
      if (!transactionPassword) {
        unfunded.push(name);
        continue;
      }
      await svc.lords.adjustPlayer({
        actor: { id: agent.id },
        userId: player.id,
        currency: 'INR',
        amount: args.balance,
        operation: 'credit',
        description: 'Demo opening balance from the agent float',
        idempotencyKey: key,
        username: name,
        transactionPassword,
      });
      funded += 1;
    }

    if (added) report('created', `${added} agent-tree player(s)`);
    if (funded) report('funded', `${funded} player(s) × ${args.balance} INR from their agent's float`);
    if (present) report('exists', `${present} agent-tree player(s) already present — passwords untouched`);
    if (fundedBefore) report('exists', `${fundedBefore} opening balance(s) already transferred`);
    if (unfunded.length) {
      report('warn', `Not funded (the agent's transaction password is not in the credentials file): ${unfunded.join(', ')}`);
    }
  },
});

// ── direct players ───────────────────────────────────────────────────────

/**
 * The direct players — not in any agent tree, each in a different state, so
 * every player screen and admin queue has a row to show.
 *
 * Datasets further down give them their money and history (cashier, vip,
 * bonuses, affiliate, tips, vault); each of those also creates the players
 * it needs, so `--only tips` works on its own.
 */
const DIRECT_PLAYERS = [
  { name: 'demo_fresh', note: 'fresh: no deposit, KYC not submitted' },
  { name: 'demo_depositor', kyc: 'Verified', bankAccounts: true, note: 'INR deposits approved + pending; withdrawals queued/approved/rejected; bank + UPI saved' },
  { name: 'demo_multicoin', kyc: 'Pending', funding: { USDT: '1500', BTC: '0.05', ETH: '0.8', TRX: '2500', EUR: '300' }, note: 'INR deposit + USDT/BTC/ETH/TRX/EUR balances; KYC pending' },
  { name: 'demo_kyc_rejected', kyc: 'Rejected', note: 'KYC rejected with a reason; one pending and one rejected deposit' },
  { name: 'demo_vip_wood', vipCard: 0, note: 'VIP — 1st card; rakeback accrued (claimable)' },
  { name: 'demo_vip_bronze', vipCard: 1, note: 'VIP — 2nd card; rakeback accrued (claimable)' },
  { name: 'demo_vip_silver', vipCard: 2, claimRakeback: true, kyc: 'Verified', note: 'VIP — 3rd card; rakeback claimed' },
  { name: 'demo_vip_gold', vipCard: 3, kyc: 'Verified', funding: { USDT: '500' }, note: 'VIP — 4th card; rakeback accrued; tips out' },
  { name: 'demo_bonus', kyc: 'Verified', note: 'an active (locked) bonus and a completed one' },
  { name: 'demo_affiliate', kyc: 'Verified', note: 'affiliate referrer: 3 referees, commission claimed + unclaimed' },
  { name: 'demo_referee1', referrer: 'demo_affiliate', note: 'referred by demo_affiliate' },
  { name: 'demo_referee2', referrer: 'demo_affiliate', note: 'referred by demo_affiliate' },
  { name: 'demo_referee3', referrer: 'demo_affiliate', note: 'referred by demo_affiliate' },
  { name: 'demo_notips', tipsEnabled: false, note: 'Settings → Allow tips is OFF' },
  { name: 'demo_vault', kyc: 'Verified', funding: { USDT: '2000' }, note: 'vault: flexible + 30-day locked deposit, interest accrued' },
];

const castSpec = (name) => DIRECT_PLAYERS.find((p) => p.name === name);

/** Create (or find) direct players by name; returns name → player. Applies the at-creation state. */
async function ensureCast(ctx, names) {
  const { sequelize } = ctx;
  const out = {};
  for (const name of names) {
    const spec = castSpec(name);
    const player = await ensurePlayer(ctx, { name, note: spec?.note ?? '' });
    if (player.created && spec?.tipsEnabled === false) {
      // At creation only: a tester who switches it back on keeps their choice on a re-run.
      await exec(sequelize, 'UPDATE userconfig SET tips_enabled = false, updatedat = now() WHERE uid = :id', { id: player.id });
    }
    if (spec?.kyc) await ensureKyc(sequelize, player, spec.kyc);
    out[name] = player;
  }
  return out;
}

const DEMO_NOTIFICATIONS = [
  { key: 'demo-seed:welcome', title: 'Welcome aboard', body: 'Your account is ready. Make a deposit to start playing.', read: true },
  { key: 'demo-seed:weekly-promo', title: 'Weekly reload is live', body: 'Deposit this weekend and spin the wheel for a bonus.', read: false },
];

DATASETS.push({
  name: 'direct',
  group: 'demo',
  ownTransaction: false,
  description: `${DIRECT_PLAYERS.length} direct players in different states: KYC, tips off, saved bank/UPI, multi-coin balances, notifications`,
  async run(ctx) {
    const { sequelize, report } = ctx;
    const before = ctx.credentials.pendingCount;
    const cast = await ensureCast(ctx, DIRECT_PLAYERS.map((p) => p.name));
    const added = ctx.credentials.pendingCount - before;
    if (added) report('created', `${added} direct player(s)`);
    if (DIRECT_PLAYERS.length - added) report('exists', `${DIRECT_PLAYERS.length - added} direct player(s) already present — passwords untouched`);

    // Saved payout accounts (migration 069): one bank account (default) and one UPI id.
    let banks = 0;
    for (const spec of DIRECT_PLAYERS.filter((p) => p.bankAccounts)) {
      const player = cast[spec.name];
      if (await one(sequelize, 'SELECT id FROM user_bank_accounts WHERE user_id = :id LIMIT 1', { id: player.id })) continue;
      const holder = `Demo ${displayName(spec.name)}`;
      await exec(
        sequelize,
        `INSERT INTO user_bank_accounts (user_id, method, account_holder_name, bank_name, account_number, ifsc_code, upi_id, is_default, created_at, updated_at)
         VALUES (:id, 'bank', :holder, 'Demo Bank', '000012345678', 'DEMO0001234', NULL, true, now(), now()),
                (:id, 'upi', :holder, NULL, NULL, NULL, :upi, false, now(), now())`,
        { id: player.id, holder, upi: `${spec.name.replace(/_/g, '')}@demoupi` }
      );
      banks += 2;
    }
    if (banks) report('created', `${banks} saved payout account(s) (bank + UPI)`);

    // Coins no player flow can produce on a dev box (the crypto provider is
    // off): a house credit through the wallet, so the ledger has the row.
    const svc = await ctx.services();
    const fundedCoins = [];
    for (const spec of DIRECT_PLAYERS.filter((p) => p.funding)) {
      for (const [currency, amount] of Object.entries(spec.funding)) {
        if (await fundDemo(svc, cast[spec.name], currency, amount)) fundedCoins.push(`${spec.name} ${amount} ${currency}`);
      }
    }
    if (fundedCoins.length) report('funded', fundedCoins.join(', '));
    else report('exists', 'coin balances already funded');

    // The bell: one read, one unread, per direct player (dedupe key = idempotent).
    let notes = 0;
    for (const spec of DIRECT_PLAYERS) {
      for (const n of DEMO_NOTIFICATIONS) {
        const row = await insertedRow(
          sequelize,
          `INSERT INTO user_notifications (user_id, title, body, type, is_read, read_at, dedupe_key, created_at)
           VALUES (:userId, :title, :body, 'general', :read, CASE WHEN :read THEN now() ELSE NULL END, :key, now())
           ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
           RETURNING id`,
          { userId: cast[spec.name].id, title: n.title, body: n.body, read: n.read, key: n.key }
        );
        if (row) notes += 1;
      }
    }
    if (notes) report('created', `${notes} notification(s) (read + unread)`);
    if (added) report('kyc', 'NotSubmitted: demo_fresh · Pending: demo_multicoin · Rejected: demo_kyc_rejected · Verified: the rest that need it');
  },
});

// ── cashier: fiat deposits and withdrawals ───────────────────────────────

/**
 * Fiat deposits in every review state, and withdrawals in every status, so
 * the admin's queues are never empty. Deposits are lodged pending and then
 * approved / rejected through `FiatDepositService` (the approval credits the
 * wallet with a DEPOSIT ledger row); withdrawals go through
 * `FiatWithdrawService.create` (KYC-verified, funds held with a WITHDRAWAL
 * row) and `updateStatus` (a rejection refunds with WITHDRAWAL_REVERSAL).
 *
 * The deposit rows carry no screenshot file, so "view proof" in the admin
 * answers not-found for them.
 */
const DEMO_DEPOSITS = [
  { player: 'demo_depositor', n: 1, amount: '25000', status: 'approved' },
  { player: 'demo_depositor', n: 2, amount: '3000', status: 'pending' },
  { player: 'demo_multicoin', n: 1, amount: '8000', status: 'approved' },
  { player: 'demo_bonus', n: 1, amount: '10000', status: 'approved' },
  { player: 'demo_vip_wood', n: 1, amount: '1500', status: 'approved' },
  { player: 'demo_kyc_rejected', n: 1, amount: '5000', status: 'pending' },
  { player: 'demo_kyc_rejected', n: 2, amount: '2000', status: 'rejected', comment: 'Payment not received — the UTR does not match any credit on our account.' },
];

const DEMO_WITHDRAWALS = [
  { player: 'demo_depositor', amount: '1000', status: 'In Queue' },
  { player: 'demo_depositor', amount: '1500', status: 'Approved' },
  { player: 'demo_depositor', amount: '2000', status: 'Rejected', comment: 'The beneficiary name does not match the KYC name.' },
];

DATASETS.push({
  name: 'cashier',
  group: 'demo',
  ownTransaction: false,
  description: 'Fiat deposits pending/approved/rejected and withdrawals queued/approved/rejected, through the real services',
  async run(ctx) {
    const { sequelize, report } = ctx;
    const names = [...new Set([...DEMO_DEPOSITS, ...DEMO_WITHDRAWALS].map((d) => d.player))];
    const cast = await ensureCast(ctx, names);
    const svc = await ctx.services();

    const handler = await one(sequelize, "SELECT id FROM staff WHERE name = 'demo_admin' LIMIT 1", {});
    const staff = handler ? { id: Number(handler.id) } : null;

    const done = { approved: 0, pending: 0, rejected: 0 };
    let present = 0;
    for (const d of DEMO_DEPOSITS) {
      const player = cast[d.player];
      const transactionId = `DEMO-${d.player}-${d.n}`;
      let row = await one(sequelize, 'SELECT deposit_id, status FROM fiat_deposits WHERE transaction_id = :transactionId LIMIT 1', { transactionId });
      if (row && row.status !== 'pending') {
        present += 1;
        continue;
      }
      if (!row) {
        row = await one(
          sequelize,
          `INSERT INTO fiat_deposits (user_id, amount, currency, bank_name, account_holder_name, transaction_id, status, created_at)
           VALUES (:userId, :amount, 'INR', 'Demo Bank', :holder, :transactionId, 'pending', now())
           RETURNING deposit_id, status`,
          { userId: player.id, amount: d.amount, holder: `Demo ${displayName(d.player)}`, transactionId }
        );
      } else if (d.status === 'pending') {
        present += 1;
        continue;
      }
      if (d.status === 'approved') await svc.fiatDeposit.approve({ depositId: row.deposit_id, comment: 'Demo seed — approved' }, staff);
      else if (d.status === 'rejected') await svc.fiatDeposit.reject({ depositId: row.deposit_id, comment: d.comment }, staff);
      done[d.status] += 1;
    }
    const wrote = Object.entries(done).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`);
    if (wrote.length) report('created', `fiat deposits: ${wrote.join(', ')}`);
    if (present) report('exists', `${present} fiat deposit(s) already in place`);

    // Withdrawals: all or nothing per player — any existing request means a run already did this.
    for (const name of [...new Set(DEMO_WITHDRAWALS.map((w) => w.player))]) {
      const player = cast[name];
      const [{ n }] = await select(sequelize, 'SELECT COUNT(*)::int AS n FROM fiat_withdrawals WHERE uid = :id', { id: player.id });
      if (n) {
        report('exists', `${name}: ${n} withdrawal request(s) already present`);
        continue;
      }
      const statuses = [];
      for (const w of DEMO_WITHDRAWALS.filter((x) => x.player === name)) {
        const created = await svc.fiatWithdraw.create({
          userId: player.id,
          details: {
            amount: w.amount,
            currency: 'INR',
            accountHolderName: `Demo ${displayName(name)}`,
            bankName: 'Demo Bank',
            accountNumber: '000012345678',
            ifscCode: 'DEMO0001234',
          },
        });
        if (w.status !== 'In Queue') {
          await svc.fiatWithdraw.updateStatus({ withdrawalId: created.withdrawalId, status: w.status, comment: w.comment ?? null }, staff);
        }
        statuses.push(`${w.amount} ${w.status}`);
      }
      report('created', `${name} withdrawals: ${statuses.join(', ')} (INR)`);
    }
  },
});

// ── VIP + rakeback ───────────────────────────────────────────────────────

/**
 * VIP standing comes from `userwager.wager` (USD). The demo turnover is
 * counted through `WagerActivityService.record` — the same entry every
 * casino/sports settlement uses — so the VIP card, the `users.rakeback` rate,
 * the level-up / rank-up credits (paid in the reward currency) and the
 * rakeback accrual all follow exactly as they would for real play. No bet is
 * placed: the activity row's source is `demo_seed`.
 *
 * Targets are read from the site's live ladder (`resolveVipLadder`): the first
 * band of the 1st/2nd/3rd/4th card (Wood, Bronze, Silver, Gold on the
 * platform ladder) plus 10%.
 *
 * Alone, `--demo` gets each player there with ONE wager on seed day. With
 * `--history` that lump would dwarf every history day on the wager, VIP and
 * rakeback charts, so this dataset leaves the wager (and the rakeback claim)
 * out and the history phase grows each player into its card over the window
 * (`vipTargets` → scripts/lib/demo-history.js). A player already on its
 * target — grown by an earlier `--history` — gets nothing more.
 */

/** The VIP cast and its target: [{ spec, band, target (USD string) | null }] on the site's live ladder. */
async function vipTargets(svc, logger) {
  const ladder = await resolveVipLadder(svc.models, { logger });
  const cards = [];
  for (const band of ladder.levels) if (!cards.some((b) => b.card === band.card)) cards.push(band);
  return DIRECT_PLAYERS.filter((p) => p.vipCard != null).map((spec) => {
    const band = cards[spec.vipCard];
    if (!band) return { spec, band: null, target: null, ladder: ladder.key };
    // Integer maths (×11/10), so $100,000 targets $110,000 rather than a float's $110,001.
    const minXp = Number(band.minXp);
    return { spec, band, target: String(Math.max(Math.ceil((minXp * 11) / 10), minXp + 100)), ladder: ladder.key };
  });
}

const vipLumpRef = (name) => `demo-seed:${name}:vip`;

DATASETS.push({
  name: 'vip',
  group: 'demo',
  ownTransaction: false,
  description: 'VIP players on 4 cards (wager through the wager feed), rakeback accrued on 3 and claimed on 1; with --history the cards are reached over the window',
  async run(ctx) {
    const { sequelize, report, logger } = ctx;
    const specs = DIRECT_PLAYERS.filter((p) => p.vipCard != null);
    const cast = await ensureCast(ctx, specs.map((p) => p.name));
    const svc = await ctx.services();
    const viaHistory = Boolean(args.history);

    const counted = [];
    const lumped = new Set();
    let present = 0;
    for (const { spec, band, target, ladder } of await vipTargets(svc, logger)) {
      if (!band) {
        report('warn', `${spec.name}: the "${ladder}" ladder has no card #${spec.vipCard + 1}`);
        continue;
      }
      const player = cast[spec.name];
      if (await one(sequelize, 'SELECT id FROM wager_activity WHERE user_id = :id AND source = :source AND ref = :ref LIMIT 1',
        { id: player.id, source: DEMO_WAGER_SOURCE, ref: vipLumpRef(spec.name) })) {
        lumped.add(spec.name);
        present += 1;
        continue;
      }
      const row = await one(sequelize, 'SELECT wager::text AS wager FROM userwager WHERE uid = :id LIMIT 1', { id: player.id });
      const missing = money.toMinor(target) - money.toMinor(money.fromStored(row?.wager ?? '0'));
      if (missing <= 0n) {
        present += 1;
        continue;
      }
      if (viaHistory) continue; // the history phase grows this player into its card
      const amount = money.toDecimalString(missing).replace(/0+$/, '').replace(/\.$/, ''); // "600", as before
      const result = await svc.wager.record({
        userId: player.id,
        amount,
        currency: 'USDT',
        source: DEMO_WAGER_SOURCE,
        ref: vipLumpRef(spec.name),
      });
      if (result.counted) {
        lumped.add(spec.name);
        counted.push(`${spec.name} → ${band.name} (${band.card}, $${amount})`);
      } else if (result.duplicate) present += 1;
      else report('warn', `${spec.name}: wager not counted (${result.reason})`);
    }
    if (counted.length) report('created', counted.join('; '));
    if (present) report('exists', `${present} VIP player(s) already on their card`);
    if (viaHistory && present + counted.length < specs.length) {
      report('skipped', 'no lump wager: --history grows the VIP cast into its cards over the window (and claims the rakeback)');
    }

    for (const spec of specs.filter((p) => p.claimRakeback && lumped.has(p.name))) {
      const player = cast[spec.name];
      const claimed = await one(sequelize, "SELECT id FROM credits_ledger WHERE user_id = :uid AND reason = 'rakeback_claim' LIMIT 1", { uid: String(player.id) });
      if (claimed) {
        report('exists', `${spec.name}: rakeback already claimed`);
        continue;
      }
      await svc.rakeback.claim({ userId: player.id });
      report('claimed', `${spec.name}: rakeback paid out`);
    }
  },
});

// ── bonuses ──────────────────────────────────────────────────────────────

/**
 * The bonus balance (migration 076), both states, through PlayerBonusService:
 *
 *   completed — a first-deposit bonus ($20, 5x) granted, then wagered past its
 *               requirement through the wager feed: released to cash (BONUS)
 *   active    — a spin-wheel bonus ($50, 20x) granted second and wagered 10%,
 *               so it sits locked with visible progress
 *
 * Order matters — wagering moves the OLDEST active bonus first — so the
 * completed one is granted and finished before the active one exists.
 * Amounts are USD-designed and priced into the site's reward currency
 * (`rewardMoney.fromUsd`), as the reward-currency rule requires.
 */
DATASETS.push({
  name: 'bonuses',
  group: 'demo',
  ownTransaction: false,
  description: 'demo_bonus: a completed (wagered → cash) and an active (locked, 10% wagered) bonus',
  async run(ctx) {
    const { report } = ctx;
    const player = (await ensureCast(ctx, ['demo_bonus'])).demo_bonus;
    const svc = await ctx.services();

    const steps = [
      { source: 'first_deposit', key: 'first-deposit', usd: '20', multiplier: 5, wagerShare: '1.2', label: 'completed' },
      { source: 'spin_wheel', key: 'spin-wheel', usd: '50', multiplier: 20, wagerShare: '0.1', label: 'active' },
    ];

    for (const step of steps) {
      const quote = await svc.rewardMoney.fromUsd(step.usd);
      const grant = await svc.playerBonuses.grant({
        userId: player.id,
        source: step.source,
        grantKey: `demo-seed:bonus:${player.name}:${step.key}`,
        ref: 'demo-seed',
        currency: quote.currency,
        amount: quote.amount,
        wagerMultiplier: step.multiplier,
        expiryDays: 30,
        description: `Demo ${step.label} bonus`,
      });
      if (grant.paid) report('granted', `${step.label} bonus ${quote.amount} ${quote.currency} (${step.multiplier}x)`);
      else if (grant.reason === 'ALREADY_PAID') report('exists', `${step.label} bonus already granted`);
      else report('warn', `${step.label} bonus not granted: ${grant.reason}`);

      const required = money.toDecimalString(money.multiply(quote.amount, String(step.multiplier)));
      const wager = money.toDecimalString(money.multiply(required, step.wagerShare));
      const result = await svc.wager.record({
        userId: player.id,
        amount: wager,
        currency: quote.currency,
        source: DEMO_WAGER_SOURCE,
        ref: `demo-seed:${player.name}:bonus-${step.key}`,
      });
      if (result.counted) report('wagered', `${wager} ${quote.currency} toward the ${step.label} bonus`);
      else if (!result.duplicate) report('warn', `bonus wager not counted (${result.reason})`);
    }
  },
});

// ── affiliate ────────────────────────────────────────────────────────────

/**
 * An affiliate with three referees. The referees join the team through
 * `AffiliateService.joinTeam` (what registration with a referral code does),
 * and their turnover runs through the wager feed, so `affiliate.onWager`
 * books real commission rows (`rewards`, % of the USD delta, priced in the
 * reward currency). Two are then claimed through `claimReward` (paid with an
 * AFFILIATE_COMMISSION ledger row); the rest stay unclaimed.
 */
DATASETS.push({
  name: 'affiliate',
  group: 'demo',
  ownTransaction: false,
  description: 'demo_affiliate + 3 referees (team rows), commission booked from their wagers, 2 claimed / rest unclaimed',
  async run(ctx) {
    const { sequelize, report } = ctx;
    const refereeNames = DIRECT_PLAYERS.filter((p) => p.referrer === 'demo_affiliate').map((p) => p.name);
    const cast = await ensureCast(ctx, ['demo_affiliate', ...refereeNames]);
    const owner = cast.demo_affiliate;
    const svc = await ctx.services();

    let joined = 0;
    for (const name of refereeNames) {
      const member = cast[name];
      if (await one(sequelize, 'SELECT membername FROM team WHERE membername = :name LIMIT 1', { name })) continue;
      await svc.affiliate.joinTeam({ userId: member.id, referralCode: owner.referralCode });
      await exec(sequelize, 'UPDATE users SET refree = :code WHERE id = :id AND refree IS NULL', { code: owner.referralCode, id: member.id });
      joined += 1;
    }
    if (joined) report('created', `${joined} referee(s) on ${owner.name}'s team (code ${owner.referralCode})`);
    else report('exists', 'team already formed');

    let counted = 0;
    for (const name of refereeNames) {
      for (const [i, amount] of ['1000', '500'].entries()) {
        const result = await svc.wager.record({
          userId: cast[name].id,
          amount,
          currency: 'USDT',
          source: DEMO_WAGER_SOURCE,
          ref: `demo-seed:${name}:aff-${i + 1}`,
        });
        if (result.counted) counted += 1;
      }
    }
    if (counted) report('wagered', `${counted} referee wager(s) counted`);

    const [{ total }] = await select(sequelize, "SELECT COUNT(*)::int AS total FROM rewards WHERE owner_id = :id AND type = 'commission'", { id: owner.id });
    if (!total) {
      report('warn', 'No commission booked — is siteconfig.comissionpercent 0? (Site config → Affiliate rates)');
      return;
    }

    const claimedBefore = await one(sequelize, "SELECT id FROM rewards WHERE owner_id = :id AND type = 'commission' AND claimed = true LIMIT 1", { id: owner.id });
    if (claimedBefore) {
      report('exists', `${total} commission row(s), some already claimed`);
      return;
    }
    const toClaim = await select(
      sequelize,
      "SELECT id FROM rewards WHERE owner_id = :id AND type = 'commission' AND claimed = false AND voided = false ORDER BY id ASC LIMIT 2",
      { id: owner.id }
    );
    for (const row of toClaim) {
      await svc.affiliate.claimReward({ userId: owner.id, rewardId: Number(row.id), kind: 'commission' });
    }
    report('claimed', `${toClaim.length} of ${total} commission row(s); ${total - toClaim.length} left unclaimed`);
  },
});

// ── tips ─────────────────────────────────────────────────────────────────

/**
 * Peer-to-peer tips through `TipService.send`: one transaction per tip with the
 * `tips` row and its TIP_SENT / TIP_RECEIVED ledger rows, the operator's limits
 * enforced, and the receiver's `tip_received` notification. A stable
 * `requestId` per tip makes a re-run a replay (nothing moves twice).
 * Senders get a small house-credited tip float first, so this works alone.
 */
const DEMO_TIPS = [
  { from: 'demo_depositor', to: 'demo_multicoin', currency: 'INR', amount: '500', note: 'gg, good luck!' },
  { from: 'demo_multicoin', to: 'demo_vip_gold', currency: 'USDT', amount: '25', note: 'thanks for the tip' },
  { from: 'demo_vip_gold', to: 'demo_depositor', currency: 'USDT', amount: '40', note: 'nice win' },
  { from: 'demo_vip_gold', to: 'demo_bonus', currency: 'USDT', amount: '15', note: null },
];
const TIP_FLOAT = { INR: '2000', USDT: '100' };

DATASETS.push({
  name: 'tips',
  group: 'demo',
  ownTransaction: false,
  description: `${DEMO_TIPS.length} tips between direct players (tips + TIP_SENT/TIP_RECEIVED ledger + notification)`,
  async run(ctx) {
    const { report } = ctx;
    const cast = await ensureCast(ctx, [...new Set(DEMO_TIPS.flatMap((t) => [t.from, t.to]))]);
    const svc = await ctx.services();

    for (const pair of new Set(DEMO_TIPS.map((t) => `${t.from}|${t.currency}`))) {
      const [from, currency] = pair.split('|');
      await fundDemo(svc, cast[from], currency, TIP_FLOAT[currency], 'tip float');
    }

    const sent = [];
    let replayed = 0;
    for (const [i, tip] of DEMO_TIPS.entries()) {
      const out = await svc.tips.send({
        userId: cast[tip.from].id,
        toUsername: tip.to,
        currency: tip.currency,
        amount: tip.amount,
        note: tip.note,
        requestId: stableUuid(`demo-seed:tip:${i}:${tip.from}:${tip.to}`),
      });
      if (out.replayed) replayed += 1;
      else sent.push(`${tip.from} → ${tip.to} ${tip.amount} ${tip.currency}`);
    }
    if (sent.length) report('created', sent.join('; '));
    if (replayed) report('exists', `${replayed} tip(s) already sent`);
  },
});

// ── vault ────────────────────────────────────────────────────────────────

/**
 * Two vault deposits through `VaultService.transferIn` (TRANSFER_OUT ledger
 * row): one on the flexible term, one locked for 30 days. Each gets today's
 * interest row the way the daily job writes it (`principal × rate / 365`,
 * once per deposit per day) — written here for the demo deposits only, so the
 * seed never accrues interest on anyone else's.
 */
DATASETS.push({
  name: 'vault',
  group: 'demo',
  ownTransaction: false,
  description: 'demo_vault: a flexible and a 30-day locked vault deposit, each with an interest row',
  async run(ctx) {
    const { sequelize, report } = ctx;
    const spec = castSpec('demo_vault');
    const player = (await ensureCast(ctx, ['demo_vault'])).demo_vault;
    const svc = await ctx.services();
    for (const [currency, amount] of Object.entries(spec.funding)) await fundDemo(svc, player, currency, amount);

    const terms = await select(sequelize, 'SELECT lock_period, days FROM vault_lock_rates WHERE is_active = true ORDER BY days ASC, id ASC', {});
    const flexible = terms.find((t) => t.lock_period === 'flexible') ?? terms[0];
    const locked = terms.find((t) => t.lock_period === '30d') ?? terms.find((t) => Number(t.days) > 0 && t !== flexible);
    if (!flexible || !locked) {
      report('warn', 'Vault terms missing — run the `vaultterms` dataset first.');
      return;
    }

    for (const [term, amount] of [[flexible, '300'], [locked, '500']]) {
      const existing = await one(sequelize, 'SELECT id FROM vault_pro WHERE userid = :id AND lock_period = :lock LIMIT 1', { id: player.id, lock: term.lock_period });
      if (existing) {
        report('exists', `vault deposit on "${term.lock_period}" already open`);
        continue;
      }
      const out = await svc.vault.transferIn({ userId: player.id, coin: 'USDT', amount, lockPeriod: term.lock_period });
      report('created', `vault deposit #${out.depositId}: ${amount} USDT on "${term.lock_period}" at ${out.interestRate}%`);
    }

    // Today's interest, once per deposit — the daily job's formula and guard.
    const withPrincipal = (await columnsOf(sequelize, 'vault_interest_history')).has('principal');
    let accrued = 0;
    const deposits = await select(sequelize, "SELECT id FROM vault_pro WHERE userid = :id AND status = 'active'", { id: player.id });
    for (const { id } of deposits) {
      const wrote = await sequelize.transaction(async (transaction) => {
        const seen = await one(sequelize, 'SELECT id FROM vault_interest_history WHERE deposit_id = :id LIMIT 1', { id }, transaction);
        if (seen) return false;
        const deposit = await one(sequelize, 'SELECT id, userid, coin, "vaultBalance" AS balance, interest_rate FROM vault_pro WHERE id = :id FOR UPDATE', { id }, transaction);
        const principal = money.toDecimalString(money.toMinor(String(deposit.balance)));
        const rate = String(deposit.interest_rate ?? '0');
        const interest = money.toDecimalString(money.divide(money.percentOf(principal, rate), 365));
        if (!money.gt(interest, '0')) return false;
        await exec(sequelize, 'UPDATE vault_pro SET "vaultBalance" = :balance, "incomeDate" = now() WHERE id = :id', { id, balance: money.toDecimalString(money.add(principal, interest)) }, transaction);
        await exec(
          sequelize,
          `INSERT INTO vault_interest_history (userid, coin, deposit_id, interest, rate, ${withPrincipal ? 'principal, ' : ''}"createdAt")
           VALUES (:userid, :coin, :id, :interest, :rate, ${withPrincipal ? ':principal, ' : ''}now())`,
          { userid: deposit.userid, coin: deposit.coin, id, interest, rate, principal },
          transaction
        );
        return true;
      });
      if (wrote) accrued += 1;
    }
    if (accrued) report('created', `${accrued} interest row(s)`);
    else report('exists', 'interest already accrued');
  },
});

// ── content and payment details ──────────────────────────────────────────

DATASETS.push({
  name: 'content',
  group: 'demo',
  description: 'A few published blog posts, so the content screens have something in them',
  async run({ sequelize, transaction, report }) {
    // The SmartBet starter posts (welcome, getting started, responsible gaming); the same
    // text scripts/rebrand-demo-content.js writes over the old iBitPlay demo rows.
    const posts = require('./rebrand-demo-content').POSTS.map(({ from: _from, ...post }) => post);

    let added = 0;
    let present = 0;

    for (const post of posts) {
      // `blogs_slug_key` is unique, and the slug is the URL — DO NOTHING so a
      // re-run never rewrites a post an operator has edited.
      const row = await insertedRow(
        sequelize,
        // `published_at` too: `is_published` defaults to true, and a published row
        // without the stamp sorts wrongly on the public list.
        `INSERT INTO blogs (slug, title, subheading, description, author, category, date, published_at, created_at, updated_at)
         VALUES (:slug, :title, :subheading, :description, 'SmartBet', :category, now(), now(), now(), now())
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        post,
        transaction
      );

      if (row) added += 1;
      else present += 1;
    }

    if (added) report('created', `${added} blog post(s)`);
    if (present) report('exists', `${present} post(s) already published`);
  },
});

DATASETS.push({
  name: 'payments',
  group: 'demo',
  description: 'Manual INR deposit details (bank + UPI) so the deposit screen has a method',
  async run({ sequelize, transaction, report }) {
    const existing = await one(
      sequelize,
      "SELECT id FROM currency_payment_details WHERE coin_type = 'INR' LIMIT 1",
      {},
      transaction
    );

    if (existing) {
      report('exists', `INR payment details (id ${existing.id})`);
      return;
    }

    const row = await one(
      sequelize,
      `INSERT INTO currency_payment_details
         (coin_type, bank_name, account_number, ifsc_code, account_holder_name, upi_id, is_active)
       VALUES
         ('INR', 'Demo Bank', '000011112222', 'DEMO0000123', 'SmartBet (demo)', 'demo@upi', true)
       RETURNING id`,
      {},
      transaction
    );

    report('created', `INR payment details (id ${row.id})`);
    report('warn', 'These are FAKE bank details. Replace them before taking a deposit.');
  },
});

// ══════════════════════════════════════════════════════════════════════════
//  Player id allocation
// ══════════════════════════════════════════════════════════════════════════

/**
 * A free player id — random, bounded, and from `crypto`.
 *
 * The same shape `AuthService.#allocateUserId` uses. Bounded rather than
 * `while (true)`: a seeder that cannot find a free id in ten tries has a
 * problem that another thousand attempts will not solve.
 */
async function allocateUserId(sequelize, transaction) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = crypto.randomInt(1_000_000_000, 9_999_999_999);
    const taken = await one(sequelize, 'SELECT id FROM users WHERE id = :candidate', { candidate }, transaction);
    if (!taken) return candidate;
  }
  throw new Error('Could not allocate a free player id after 10 attempts');
}

// ══════════════════════════════════════════════════════════════════════════
//  Ledger check
// ══════════════════════════════════════════════════════════════════════════

/**
 * Every demo wallet against the sum of its own ledger, per currency — the
 * same question `WalletService.reconcile` asks. A mismatch means something
 * wrote a balance without a ledger row (e.g. a demo player created by an
 * older version of this script, which inserted balances directly).
 */
async function reconcileDemoWallets(sequelize) {
  const { CURRENCY_COLUMN } = require(path.join(ROOT, 'services/user/src/modules/wallet/wallet.constants'));
  const present = await columnsOf(sequelize, 'credits');
  // Column names come from the wallet's allow-list, never from input.
  const pairs = Object.entries(CURRENCY_COLUMN).filter(([, col]) => present.has(col));
  const players = await select(
    sequelize,
    `SELECT u.id, u.name, ${pairs.map(([, col]) => `COALESCE(c.${col}, 0)::text AS ${col}`).join(', ')}
       FROM users u LEFT JOIN credits c ON c.uid = u.id
      WHERE u.name LIKE 'demo\\_%' OR u.email LIKE 'demo\\_%'`,
    {}
  );
  if (!players.length) return { checked: 0, mismatches: [] };

  const sums = await select(
    sequelize,
    `SELECT user_id, upper(currency) AS currency, SUM(amount)::text AS total
       FROM credits_ledger WHERE user_id IN (:ids) GROUP BY user_id, upper(currency)`,
    { ids: players.map((p) => String(p.id)) }
  );
  const ledger = new Map(sums.map((s) => [`${s.user_id}|${s.currency}`, s.total]));

  const mismatches = [];
  for (const p of players) {
    for (const [code, col] of pairs) {
      const balance = money.fromStored(String(p[col] ?? '0'));
      const total = money.fromStored(String(ledger.get(`${p.id}|${code}`) ?? '0'));
      if (money.compare(balance, total) !== 0) mismatches.push({ name: p.name, currency: code, balance, ledger: total });
    }
  }
  return { checked: players.length, mismatches };
}

// ══════════════════════════════════════════════════════════════════════════
//  The runner
// ══════════════════════════════════════════════════════════════════════════

function listDatasets() {
  say(`\n${bold('Datasets')}\n`);

  for (const group of ['config', 'demo']) {
    const label = group === 'config' ? 'config  — safe anywhere, run by default' : 'demo    — needs --demo';
    say(`  ${bold(label)}`);
    for (const dataset of DATASETS.filter((d) => d.group === group)) {
      say(`    ${cyan(dataset.name.padEnd(12))} ${dim(dataset.description)}`);
    }
    say('');
  }

  say(`${bold('Usage')}`);
  say(`  ${cyan('node scripts/seed-data.js')}                          ${dim('config only')}`);
  say(`  ${cyan('node scripts/seed-data.js --demo')}                   ${dim('config + demo')}`);
  say(`  ${cyan('node scripts/seed-data.js --only sports,rates')}      ${dim('just these')}`);
  say(`  ${cyan('node scripts/seed-data.js --demo --skip bootstrap')}  ${dim('everything but these')}`);
  say(`  ${cyan('node scripts/seed-data.js --demo --players 20')}      ${dim('more agent-tree players')}`);
  say(`  ${cyan('node scripts/seed-data.js --demo --balance 5000')}    ${dim('opening INR per agent-tree player')}`);
  say(`  ${cyan('node scripts/seed-data.js --reset-demo')}             ${dim('dry run: what a reset would delete')}`);
  say(`  ${cyan('node scripts/seed-data.js --reset-demo --yes')}       ${dim('delete every demo_ account and its rows')}`);
  say(`  ${cyan('node scripts/seed-data.js --demo --history')}         ${dim(`+ ${DEFAULT_HISTORY_DAYS} days of backdated activity (charts)`)}`);
  say(`  ${cyan('node scripts/seed-data.js --history 30')}             ${dim(`history only, after --demo (1–${MAX_HISTORY_DAYS} days; keeps its VIP lump)`)}`);
  say(`  ${cyan('  … --history-seed 7')}                             ${dim('another reproducible variation')}`);
  say('');
  say(`  ${dim(`Demo passwords are random per account and are written only to ${credentialsPath()}`)}`);
  say(`  ${dim('(gitignored). Re-runs never rotate them. --force allows demo/reset with NODE_ENV=production.')}`);
  say('');
}

function chooseDatasets() {
  const known = (name) => {
    const dataset = DATASETS.find((d) => d.name === name);
    if (!dataset) {
      say(`${red('Unknown dataset')} "${name}". Try ${cyan('--list')}.`);
      process.exit(1);
    }
    return dataset;
  };
  args.skip.forEach(known);

  // `--history` on its own: the history phase only, on an already seeded cast.
  if (args.history && !args.demo && !args.only) return [];

  const chosen = args.only
    ? args.only.map(known)
    : DATASETS.filter((d) => d.group === 'config' || (args.demo && d.group === 'demo'));
  return chosen.filter((d) => !args.skip.includes(d.name));
}

function refuseInProduction(config, what) {
  if (config.NODE_ENV !== 'production' || args.force) return;
  say(`\n${red(`Refusing to ${what} with NODE_ENV=production.`)}`);
  say('  Demo accounts are real, working logins.');
  say(`\n  ${dim('If this is a staging box, re-run with --force.')}\n`);
  process.exit(1);
}

async function runReset({ sequelize, config, logger }) {
  const { resetDemo } = require('./lib/demo-reset');
  const out = await resetDemo({ sequelize, apply: args.yes, logger });

  if (out.blocked.length) {
    say(`${red('✗ Reset refused:')}`);
    for (const reason of out.blocked) say(`  ${red('·')} ${reason}`);
    say(dim('  Move or delete those accounts first — they are not demo data, so this will not touch them.\n'));
    return 1;
  }

  say(`${bold(`${out.users.length} demo player(s), ${out.staff.length} demo staff account(s)`)}`);
  if (!out.steps.length) say(`  ${dim('· nothing to delete')}`);
  for (const step of out.steps) say(`  ${args.yes ? green('✓') : dim('·')} ${step.label.padEnd(36)} ${step.count}`);

  if (!args.yes) {
    say(`\n${yellow('Dry run — nothing was deleted.')} Re-run with ${cyan('--reset-demo --yes')} to delete these rows.\n`);
    return 0;
  }

  const removed = removeRowsFor(dbLabelOf(config));
  say(`\n${green('✓')} ${bold('Demo data removed.')}${removed ? dim(` ${removed} row(s) dropped from ${credentialsPath()}.`) : ''}\n`);
  return 0;
}

/**
 * `--history`: generate, backdate, reconcile, summarise. Returns false on a
 * failure or any ledger mismatch (the caller exits non-zero).
 */
async function runHistoryPhase({ sequelize, config, logger, credentials, dbLabel, getServices }) {
  const { runHistory, reconcileAll } = require('./lib/demo-history');
  say(`${blue(`▸ history`)} ${dim(`${args.history} day(s) of demo activity, seed ${args.historySeed}, backdated`)}`);

  const services = await getServices();
  const ctx = { sequelize, config, logger, credentials, dbLabel };
  const fmt = (d) => new Date(d).toISOString().slice(0, 10);
  let out;
  try {
    const vip = {
      source: DEMO_WAGER_SOURCE,
      players: (await vipTargets(services, logger))
        .filter((t) => t.target)
        .map((t) => ({ name: t.spec.name, target: t.target, card: t.spec.vipCard, claimRakeback: Boolean(t.spec.claimRakeback) })),
    };
    out = await runHistory({
      vip,
      sequelize,
      services,
      days: args.history,
      seed: args.historySeed,
      helpers: {
        createPlayer: (name, note) => ensurePlayer(ctx, { name, note }),
        setKyc: (player, status) => ensureKyc(sequelize, player, status),
      },
      progress: (line) => say(`  ${dim(`· ${line}`)}`),
    });
  } catch (error) {
    say(`  ${red('✗')} ${red(error.message)}`);
    const cause = error?.parent || error?.original;
    if (cause?.message && cause.message !== error.message) say(`    ${dim(cause.message)}`);
    if (error?.code) say(`    ${dim(`code ${error.code}${error.details ? ` ${JSON.stringify(error.details)}` : ''}`)}`);
    return false;
  } finally {
    // Players the run created are real accounts: their rows go on file either way.
    credentials.flush();
  }

  if (out.skipped) {
    const e = out.existing;
    say(`  ${dim('·')} ${dim(`exists: ${e.n} history ledger row(s), ${fmt(e.first)} → ${fmt(e.last)} — not generated again.`)}`);
    say(`  ${dim('  To regenerate (another span or seed): --reset-demo --yes, then --demo --history.')}\n`);
  } else {
    say(`  ${green('✓')} ${out.events} event(s), ${out.historyPlayers} history player(s), ${fmt(out.span.from)} → ${fmt(out.span.to)}`);
    const kinds = Object.entries(out.byKind).sort(([a], [b]) => a.localeCompare(b));
    say(`  ${green('✓')} events: ${kinds.map(([k, n]) => `${k} ${n}`).join(', ')}`);
    const tables = Object.entries(out.touched).sort(([a], [b]) => a.localeCompare(b));
    say(`  ${green('✓')} rows backdated per table:`);
    for (let i = 0; i < tables.length; i += 4) {
      say(`      ${tables.slice(i, i + 4).map(([t, n]) => `${t} ${n}`.padEnd(30)).join('')}`);
    }
    if (out.vipGrowth.length) {
      say(`  ${green('✓')} VIP cast grown into its cards: ${out.vipGrowth.map((v) => `${v.name} $${v.usd} in ${v.rounds} rounds`).join(', ')}`);
    }
    if (out.lump.length) {
      say(`  ${yellow('!')} ${yellow(`${out.lump.join(', ')} got their VIP card in one seed-day wager (an earlier --demo without --history);`)}`);
      say(`    ${yellow('that day stays a spike on the wager, VIP and rakeback charts. For a clean curve:')}`);
      say(`    ${cyan('--reset-demo --yes')}${yellow(', then')} ${cyan('--demo --history')}`);
    }
    const refused = Object.entries(out.refused);
    if (refused.length) {
      say(`  ${yellow('!')} ${yellow(`refused by a service (skipped, money unchanged): ${refused.map(([k, n]) => `${k} ×${n}`).join(', ')}`)}`);
    }
  }

  // Every demo wallet against its ledger, through the wallet's own check.
  const check = await reconcileAll({ sequelize, wallet: services.wallet });
  if (check.mismatches.length) {
    say(`  ${red('✗')} ${red(`${check.mismatches.length} demo wallet(s) do NOT reconcile with their ledger:`)}`);
    for (const m of check.mismatches.slice(0, 20)) say(`      ${m.name} ${m.currency}: balance ${m.balance}, ledger ${m.ledger}, drift ${m.drift}`);
    say('');
    return false;
  }
  say(`  ${green('✓')} WalletService.reconcile: ${check.wallets} wallet(s) of ${check.checked} demo player(s) balanced\n`);
  return true;
}

async function main() {
  if (args.list) {
    listDatasets();
    return;
  }

  const config = loadEnv(
    {
      ...dbEnvShape,
      BCRYPT_ROUNDS: coercers.int(12),
      LOG_PRETTY: coercers.bool(true),
    },
    { serviceDir: ROOT }
  );

  const logger = createLogger({ service: 'seed-data', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });
  const dbLabel = dbLabelOf(config);

  const header = (title) => {
    say(`\n${bold(`iBitPlay — ${title}`)}`);
    say(dim(`${config.DB_USER}@${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}  ·  NODE_ENV=${config.NODE_ENV}`));
  };

  if (args.resetDemo) {
    refuseInProduction(config, 'reset demo data');
    header(args.yes ? 'demo reset' : 'demo reset (dry run)');
    say('');
    const sequelize = createSequelize(config, logger);
    await authenticate(sequelize, logger);
    try {
      process.exitCode = await runReset({ sequelize, config, logger });
    } finally {
      await sequelize.close();
    }
    return;
  }

  const chosen = chooseDatasets();
  const wantsDemo = chosen.some((d) => d.group === 'demo') || Boolean(args.history);

  /**
   * The production guard.
   *
   * Demo datasets create real accounts. `--force` exists because a staging
   * box legitimately runs with NODE_ENV=production, but it has to be typed.
   */
  if (wantsDemo) refuseInProduction(config, 'seed demo data');

  header('data runner');
  say(dim(`${chosen.length} dataset(s): ${chosen.map((d) => d.name).join(', ') || '—'}${args.history ? ` + ${args.history} day(s) of history` : ''}\n`));

  const sequelize = createSequelize(config, logger);
  await authenticate(sequelize, logger);

  // The money services, built on first use by a dataset that needs them.
  // Quiet unless something is wrong: their info lines are per movement.
  let services = null;
  const serviceLogger = createLogger({
    service: 'seed-data:services',
    level: process.env.SEED_SERVICE_LOG_LEVEL || 'warn',
    pretty: config.LOG_PRETTY,
  });
  const getServices = async () => {
    if (!services) {
      const { createDemoServices } = require('./lib/demo-services');
      services = createDemoServices({ sequelize, logger: serviceLogger });
    }
    return services;
  };

  const credentials = createCredentialsBook({ dbLabel });
  const results = {};
  const failures = [];

  for (const dataset of chosen) {
    const lines = [];
    const report = (kind, message) => lines.push({ kind, message });

    say(`${blue(`▸ ${dataset.name}`)} ${dim(dataset.description)}`);

    try {
      const context = { sequelize, config, logger, report, credentials, results, dbLabel, services: getServices };

      // Each dataset in its own transaction, so a failure costs one dataset
      // rather than the whole run. `bootstrap` and the money datasets opt out
      // (see the DATASETS note).
      results[dataset.name] = dataset.ownTransaction === false
        ? await dataset.run({ ...context, transaction: undefined })
        : await sequelize.transaction((transaction) => dataset.run({ ...context, transaction }));

      credentials.flush();

      for (const line of lines) {
        if (line.kind === 'warn') say(`  ${yellow('!')} ${yellow(line.message)}`);
        else if (line.kind === 'exists' || line.kind === 'skipped') say(`  ${dim('·')} ${dim(`${line.kind}: ${line.message}`)}`);
        else say(`  ${green('✓')} ${line.message}`);
      }
      if (!lines.length) say(`  ${dim('· nothing to do')}`);
    } catch (error) {
      // A rolled-back dataset created no accounts; a service-driven one has
      // committed every account it got to, and those must be on file.
      if (dataset.ownTransaction === false) credentials.flush();
      else credentials.discard();

      failures.push({ dataset: dataset.name, error });
      say(`  ${red('✗')} ${red(error.message)}`);
      const cause = error?.parent || error?.original;
      if (cause?.message && cause.message !== error.message) say(`    ${dim(cause.message)}`);
      if (error?.code) say(`    ${dim(`code ${error.code}${error.details ? ` ${JSON.stringify(error.details)}` : ''}`)}`);
    }

    say('');
  }

  // ── History: the past, backdated (scripts/lib/demo-history.js) ────────
  let historyFailed = false;
  if (args.history) {
    const demoFailed = failures.filter((f) => DATASETS.find((d) => d.name === f.dataset)?.group === 'demo');
    if (demoFailed.length) {
      say(`${yellow('!')} ${yellow(`History skipped: demo dataset(s) failed (${demoFailed.map((f) => f.dataset).join(', ')}).`)}\n`);
    } else {
      historyFailed = !(await runHistoryPhase({ sequelize, config, logger, credentials, dbLabel, getServices }));
    }
  }

  if (services) await services.close();

  let mismatches = [];
  if (wantsDemo) {
    const check = await reconcileDemoWallets(sequelize);
    mismatches = check.mismatches;
    if (check.checked) {
      if (mismatches.length) {
        say(`${yellow('!')} ${yellow(`${mismatches.length} demo wallet balance(s) do not match their ledger:`)}`);
        for (const m of mismatches.slice(0, 10)) say(`    ${m.name} ${m.currency}: balance ${m.balance}, ledger ${m.ledger}`);
        say(dim('  Rows from an older seed? `--reset-demo --yes` and seed again.\n'));
      } else {
        say(`${green('✓')} ${check.checked} demo wallet(s) reconcile with their ledger\n`);
      }
    }
  }

  await sequelize.close();

  // ── Summary — counts and a path, never a password ────────────────────

  if (wantsDemo) {
    say(credentials.written
      ? `${green('✓')} ${bold(`${credentials.written} demo account(s) created`)} — logins and passwords in ${cyan(credentialsPath())}`
      : `${dim('·')} No new demo accounts — existing passwords unchanged (${credentialsPath()})`);
    say('');
  }

  if (failures.length) {
    say(`${red(bold(`${failures.length} dataset(s) failed:`))} ${failures.map((f) => f.dataset).join(', ')}`);
    say(dim('Everything else was committed. Fix the cause and re-run — this script is idempotent.\n'));
    process.exit(1);
  }
  if (historyFailed) {
    say(`${red(bold('The history phase failed.'))} ${dim('`--reset-demo --yes`, then seed again.')}\n`);
    process.exit(1);
  }

  say(`${green('✓')} ${bold('Data loaded.')}\n`);
}

main().catch((error) => {
  const cause = error?.cause || error?.parent || error?.original;
  say(`\n${red('✗ The data runner failed')}`);
  say(`  ${error.message}`);
  if (cause?.message && cause.message !== error.message) say(`  ${dim(`caused by: ${cause.message}`)}`);
  if (cause?.sql) say(`  ${dim(`sql: ${String(cause.sql).slice(0, 300)}`)}`);
  say('');
  process.exit(1);
});

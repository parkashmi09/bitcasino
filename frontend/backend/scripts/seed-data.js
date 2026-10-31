#!/usr/bin/env node
'use strict';

/**
 * The data runner — everything the platform needs in its tables, on demand.
 *
 *   node scripts/seed-data.js              platform configuration
 *   node scripts/seed-data.js --demo       …and a demo staff tree, players and content
 *   node scripts/seed-data.js --only sports,rates
 *   node scripts/seed-data.js --list       what each dataset writes
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
 *   demo     Fake staff, fake players, fake content. Refuses to run when
 *            NODE_ENV=production without --force, because these are real
 *            accounts with a password printed to the terminal.
 * ═════════════════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');

const { hashPassword } = require('@ibitplay/auth');
const { loadEnv, dbEnvShape, coercers, createLogger } = require('@ibitplay/common');
const { createSequelize, authenticate } = require('@ibitplay/db/src/sequelize');
const { createMigrator } = require('@ibitplay/db/src/migrator');
const { QueryTypes } = require('sequelize');

const ROOT = path.resolve(__dirname, '..');

/**
 * The sport ids, taken from the service rather than copied.
 *
 * `sports_config.game_id` is compared against the feed's `etid`, so a copy here
 * that drifts from `SPORT_NAMES` would produce catalogue rows for sports the
 * board can never match — enabled in the admin panel, invisible to players,
 * with nothing to explain the difference.
 */
const { SPORT_NAMES } = require(path.join(ROOT, 'services/sports/src/modules/feed/feed.constants.js'));

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
    list: false,
    force: false,
    players: 5,
    password: 'Demo@12345',
    balance: '10000',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];

    switch (arg) {
      case '--demo': args.demo = true; break;
      case '--all': args.demo = true; break;
      case '--list': args.list = true; break;
      case '--force': args.force = true; break;
      case '--only': args.only = String(next() || '').split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--players': args.players = Math.max(0, Math.min(200, Number(next()) || 0)); break;
      case '--password': args.password = String(next() || args.password); break;
      case '--balance': args.balance = String(next() || args.balance); break;
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

// ══════════════════════════════════════════════════════════════════════════
//  The datasets
// ══════════════════════════════════════════════════════════════════════════

/**
 * A dataset is `{ name, group, description, run }`.
 *
 * `run` gets `{ sequelize, transaction, config, logger, report }` and calls
 * `report(...)` for each thing it wrote. Every one runs inside its own
 * transaction, so a dataset that fails leaves the ones before it in place and
 * the run continues — the alternative is one bad row rolling back a full seed.
 *
 * `ownTransaction: false` opts out, for the one dataset that manages its own.
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

DATASETS.push({
  name: 'siteconfig',
  group: 'config',
  description: 'The single settings row every feature flag hangs off',
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
    const existing = await one(sequelize, 'SELECT id FROM siteconfig LIMIT 1', {}, transaction);

    const id =
      existing?.id ??
      (
        await one(
          sequelize,
          `INSERT INTO siteconfig (registerbonus, createdat, updatedat)
           VALUES (:registerbonus, now(), now())
           RETURNING id`,
          { registerbonus: process.env.SEED_REGISTER_BONUS || '0' },
          transaction
        )
      ).id;

    report(
      existing ? 'exists' : 'created',
      `siteconfig row (id ${id})${existing ? '' : ' — every flag at its schema default'}`
    );

    /**
     * The sportsbook kill switch, seeded rather than clicked.
     *
     * `sportsEnabled()` reads a MISSING row as `true`, so an unconfigured
     * deployment is one where sports is on and only a stopped process hides
     * it. This front end has no sportsbook surface at all, and "off" that
     * survives a `setup:fresh` has to be seeded — a value somebody remembered
     * to PUT once is not a property of the deployment.
     *
     * Written on every run, existing row included: it is the one flag whose
     * value here is a deliberate deployment decision rather than a default to
     * be left alone. `SEED_SPORTS_ENABLED=true` turns the board back on, which
     * is step 4 of the switch-sports-on list in
     * `docs/10-backend-integration.md`.
     */
    const sports = String(process.env.SEED_SPORTS_ENABLED || 'false') === 'true';

    await exec(
      sequelize,
      'UPDATE siteconfig SET sports = :sports, updatedat = now() WHERE id = :id',
      { sports, id },
      transaction
    );

    report('created', `sportsbook ${sports ? 'ENABLED' : 'disabled'} (siteconfig.sports)`);
  },
});

// ── sports catalogue ─────────────────────────────────────────────────────

/**
 * Which sports a fresh deployment shows.
 *
 * `sports_config.enabled` is the operator's switch for what PLAYERS SEE — a
 * separate question from `SPORTS_ACTIVE_EIDS`, which is what the deployment
 * pays the provider to fetch. Three on by default because that is what the
 * board actually trades; the other sixteen are catalogued so the admin panel
 * can list them, and switched off so nobody sees an empty tab.
 */
const DEFAULT_ENABLED_SPORTS = [4, 1, 2]; // Cricket, Soccer, Tennis

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
        'SELECT id FROM sports_config WHERE game_id = :gameId LIMIT 1',
        { gameId: Number(gameId) },
        transaction
      );

      if (existing) {
        present += 1;
        continue;
      }

      await exec(
        sequelize,
        `INSERT INTO sports_config (game_id, game_name, enabled, created_at, updated_at)
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

/**
 * The five in-house games whose tile is the reference's own artwork rather
 * than a drawing of it.
 *
 * Mirrors `CAPTURED_ORIGINALS` in `apps/web`'s `scripts/art.mjs`, which is
 * where the CDN sources live; `npm run assets:originals` writes the files and
 * `npm run assets:gen` skips drawing over them. Only the extension differs, so
 * a set membership is all `inHouseRow` needs.
 *
 * `apps/web/scripts/verify-api-contract.mjs` walks every path the catalogue
 * emits and asserts it exists on disk, so a name that falls out of step with
 * the files fails there rather than as a broken-image glyph in the grid.
 */
const CAPTURED_ART = new Set(['plinko', 'blackjack', 'hilo', 'classic_dice', 'roulette']);

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

// ── the lobby catalogue ──────────────────────────────────────────────────

/**
 * `gisgamesnew` — the table every public catalogue route reads.
 *
 * `/casino/games`, `/games/search`, `/games/providers`, `/games/stats` and all
 * five curated collections read this one table. In production it is filled by
 * `POST /api/v1/admin/casino/gis/sync/games`, which needs GIS_MERCHANT_ID and
 * GIS_MERCHANT_KEY. Without those the table is empty, every lobby endpoint
 * answers `[]`, and a front end wired correctly to this platform renders a
 * working shell over no content — which looks exactly like a broken
 * integration and is not one.
 *
 * So this fills the same table from `apps/web/src/data/catalog.js`, the
 * generated placeholder catalog the web app already ships art for. The rows are
 * the real shape in the real table: nothing downstream can tell the difference,
 * and a real sync later overwrites them by uuid.
 *
 * The catalog module is plain ESM with no imports of its own, so it is read
 * with a dynamic `import()` rather than copied — `scripts/generate-assets.mjs`
 * in that repo reads it the same way, and a copy here would drift the first
 * time somebody adds a game.
 *
 * `config`, not `demo`: an empty lobby is not a missing convenience, it is a
 * platform that cannot serve its main page.
 */

/** Collection slug -> table. The service constant names the model, not the table. */
const COLLECTION_TABLES = Object.freeze({
  hot: 'hot_games',
  'live-casino': 'live_casino',
  'popular-slots': 'popular_slots',
  crash: 'crash_games',
  indian: 'indian_games',
});

/**
 * How each collection is cut from the catalogue.
 *
 * `indian` has no equivalent in this catalogue — it is a market segment, not a
 * genre — so it takes the table games rather than being left empty, which would
 * render one dead rail on the home page.
 */
const COLLECTION_PICKS = Object.freeze({
  hot: (rows) => rows.filter((r) => r.label === 'hot' || r.label === 'exclusive'),
  'live-casino': (rows) => rows.filter((r) => r.type === 'live-casino' || r.type === 'game-shows'),
  'popular-slots': (rows) => rows.filter((r) => r.type === 'video-slots' || r.type === 'jackpots'),
  crash: (rows) => rows.filter((r) => r.type === 'crash'),
  indian: (rows) => rows.filter((r) => r.type === 'table-games'),
});

/** One placeholder game, as a catalogue row. */
const catalogueRow = (game) => ({
  uuid: game.slug,
  name: game.title,
  provider: game.provider,
  type: game.category,
  image: game.thumb,
  technology: 'html5',
  hasLobby: game.category === 'live-casino' || game.category === 'game-shows',
  isMobile: true,
  label: game.badge ?? null,
  /**
   * `rtp`, `volatility` and `hitRatio` have no column. They are the web app's
   * own fields and the category page's sort control reads all three, so they
   * go in the JSONB the table already carries rather than costing a migration
   * for placeholder data.
   */
  parameters: {
    rtp: game.rtp,
    volatility: game.volatility,
    hitRatio: game.hitRatio,
    ...(game.players === undefined ? {} : { players: game.players }),
    ...(game.jackpot === undefined ? {} : { jackpot: game.jackpot }),
    // The slot's bonus round is for sale. `/themes/bonus-buy-in` cuts on it,
    // and like the three stats above it has no column of its own.
    ...(game.bonusBuy === true ? { bonusBuy: true } : {}),
  },
  images: { portrait: game.thumb, landscape: game.thumbWide },
});

/**
 * The in-house games, as catalogue rows.
 *
 * They are already in `js_games` (the `games` dataset above), which is what bet
 * history joins against. They are NOT in `gisgamesnew`, so the lobby cannot see
 * the twenty games this platform can actually deal without a provider account.
 *
 * `parameters.inHouse` is how a client tells them apart: an in-house game is a
 * `PLAY_*` socket event against casino-service, not a provider iframe.
 */
const inHouseRow = (uid, title) => {
  /**
   * Its own artwork, both crops.
   *
   * This was `/images/categories/originals.png` for every one of the twenty —
   * the 64x64 sidebar nav icon, which the 140x188 tile scaled up seven times
   * into a blur, twenty-one identical copies of it down
   * `/categories/originals`.
   *
   * Now five of them carry the reference's real thumbnail (`.avif`, fetched by
   * `npm run assets:originals`) and the other fifteen a drawing in the same art
   * direction (`.svg`, written by `npm run assets:gen`) — so the extension is
   * the one thing the path cannot derive from the uid alone.
   *
   * `images.landscape` is the 1.3:1 crop the home page's featured rail reads,
   * and the Originals rail IS the featured rail.
   */
  const ext = CAPTURED_ART.has(uid) ? '.avif' : '.svg';
  const portrait = `/images/originals/${uid}${ext}`;

  return {
    uuid: uid,
    name: title,
    provider: 'In-House',
    type: 'originals',
    image: portrait,
    technology: 'html5',
    hasLobby: false,
    isMobile: true,
    label: null,
    parameters: { inHouse: true, event: uid },
    images: { portrait, landscape: `/images/originals/${uid}-wide${ext}` },
  };
};

DATASETS.push({
  name: 'catalogue',
  group: 'config',
  description: 'Lobby catalogue in gisgamesnew, plus the five curated collections',
  async run({ sequelize, transaction, report }) {
    const catalogPath = path.resolve(ROOT, '../apps/web/src/data/catalog.js');

    let catalog;
    try {
      catalog = await import(pathToFileURL(catalogPath).href);
    } catch (error) {
      report('skip', `no web catalog at ${catalogPath} — ${error.message}`);
      return;
    }

    // Read from the service rather than copying: a renamed collection fails
    // here loudly instead of seeding a rail nobody serves.
    const { COLLECTIONS } = require(path.join(ROOT, 'services/casino/src/modules/games/games.constants.js'));
    const { GAMES: IN_HOUSE } = require(path.join(ROOT, 'services/casino/src/modules/in-house/inHouse.constants.js'));

    const rows = [
      ...catalog.GAMES.map(catalogueRow),
      ...IN_HOUSE.map((uid) => inHouseRow(uid, IN_HOUSE_TITLES[uid] || uid)),
    ];

    for (const row of rows) {
      // `gisgamesnew_uuid_key` is a real unique constraint. DO UPDATE rather
      // than DO NOTHING — unlike `js_games`, nobody hand-edits a synced
      // catalogue row, and a re-run is how a retitled game is picked up.
      await exec(
        sequelize,
        `INSERT INTO gisgamesnew
           (uuid, name, provider, type, image, technology,
            has_lobby, is_mobile, has_freespins, label,
            parameters, images, updated_at, created_at)
         VALUES
           (:uuid, :name, :provider, :type, :image, :technology,
            :hasLobby, :isMobile, false, :label,
            CAST(:parameters AS jsonb), CAST(:images AS jsonb), :updatedAt, now())
         ON CONFLICT (uuid) DO UPDATE SET
           name        = EXCLUDED.name,
           provider    = EXCLUDED.provider,
           type        = EXCLUDED.type,
           image       = EXCLUDED.image,
           technology  = EXCLUDED.technology,
           has_lobby   = EXCLUDED.has_lobby,
           is_mobile   = EXCLUDED.is_mobile,
           label       = EXCLUDED.label,
           parameters  = EXCLUDED.parameters,
           images      = EXCLUDED.images,
           updated_at  = EXCLUDED.updated_at`,
        {
          ...row,
          parameters: JSON.stringify(row.parameters),
          images: JSON.stringify(row.images),
          updatedAt: Date.now(),
        },
        transaction
      );
    }

    report('created', `${rows.length} catalogue game(s) in gisgamesnew`);

    /**
     * `gis_providers` is a SECOND catalogue, and nothing derives it from the
     * first. `GET /casino/games/providers` reads this table; `/games/stats`
     * counts `DISTINCT provider` on `gisgamesnew`. Seeding only the games
     * leaves the two disagreeing — stats says nine providers and the providers
     * list says none, which is the providers page rendering empty on a
     * catalogue that plainly has providers in it.
     *
     * The table is one `text` column with NO primary key and NO enforced
     * unique index (see the model's own note), so `ON CONFLICT` has no
     * arbiter to name. `WHERE NOT EXISTS` is what makes a re-run a no-op here.
     */
    const providers = [...new Set(rows.map((r) => r.provider))].sort();

    for (const name of providers) {
      await exec(
        sequelize,
        `INSERT INTO gis_providers (name)
         SELECT :name
         WHERE NOT EXISTS (SELECT 1 FROM gis_providers WHERE name = :name)`,
        { name },
        transaction
      );
    }

    report('created', `${providers.length} provider(s) in gis_providers`);

    for (const [slug, table] of Object.entries(COLLECTION_TABLES)) {
      const meta = COLLECTIONS[slug];
      if (!meta) {
        report('skip', `casino-service no longer serves the "${slug}" collection`);
        continue;
      }

      const uuids = COLLECTION_PICKS[slug](rows).map((r) => r.uuid);
      if (!uuids.length) {
        report('skip', `"${slug}" selected no games`);
        continue;
      }

      // `hot_games` is the only one of the five with a `created_at` column; the
      // other four were added later and never got one. Hence the conditional
      // rather than one statement that would fail on four tables out of five.
      const createdAt = table === 'hot_games';

      await exec(
        sequelize,
        `INSERT INTO ${table} (key, game_uuids, updated_at${createdAt ? ', created_at' : ''})
         VALUES (:key, :uuids, now()${createdAt ? ', now()' : ''})
         ON CONFLICT (key) DO UPDATE SET
           game_uuids = EXCLUDED.game_uuids,
           updated_at = EXCLUDED.updated_at`,
        { key: meta.key, uuids: uuids.join(',') },
        transaction
      );

      report('created', `collection "${slug}" — ${uuids.length} game(s)`);
    }
  },
});

// ══════════════════════════════════════════════════════════════════════════
//  Demo data
// ══════════════════════════════════════════════════════════════════════════

/**
 * The staff tree.
 *
 * One account per level below Super Admin, because most of what goes wrong in
 * an RBAC surface goes wrong for somebody who is NOT the owner — a tree with
 * only a superadmin in it cannot exercise a single scoped query.
 *
 * Role ids come from `001-roles-and-admin`: 1 Super Admin … 7 Executive.
 */
const DEMO_STAFF = [
  { name: 'demo_supermaster', email: 'supermaster@demo.local', roleId: 4, parent: null, percentage: 10 },
  { name: 'demo_master', email: 'master@demo.local', roleId: 5, parent: 'demo_supermaster', percentage: 8 },
  { name: 'demo_agent', email: 'agent@demo.local', roleId: 6, parent: 'demo_master', percentage: 5 },
  { name: 'demo_executive', email: 'executive@demo.local', roleId: 7, parent: 'demo_supermaster', percentage: 0 },
];

DATASETS.push({
  name: 'staff',
  group: 'demo',
  description: 'A four-deep staff tree under the super-admin, with hierarchy rows and balances',
  async run({ sequelize, transaction, config, report, credentials }) {
    const rootRow = await one(
      sequelize,
      'SELECT id FROM staff WHERE role_id = 1 ORDER BY id ASC LIMIT 1',
      {},
      transaction
    );

    if (!rootRow) {
      throw new Error(
        'No super-admin exists — run the bootstrap seeders first (`npm run db:seed`, or this script without --only)'
      );
    }

    const passwordHash = await hashPassword(args.password, config.BCRYPT_ROUNDS);
    const byName = new Map();

    for (const person of DEMO_STAFF) {
      const existing = await one(
        sequelize,
        'SELECT id FROM staff WHERE email = :email LIMIT 1',
        { email: person.email },
        transaction
      );

      if (existing) {
        // Never re-hashed. This is a password reset on an account somebody may
        // be signed into — see `scripts/seed-test-logins.js`, which exists to
        // do that deliberately and guards itself accordingly.
        byName.set(person.name, existing.id);
        report('exists', `${person.email} (staff ${existing.id}) — password untouched`);
        credentials.staff.push({ email: person.email, role: person.roleId, existing: true });
        continue;
      }

      const parentId = person.parent ? byName.get(person.parent) : rootRow.id;

      const inserted = await one(
        sequelize,
        `INSERT INTO staff (name, email, password, role_id, parent_id, percentage, status, first_login, created_at)
         VALUES (:name, :email, :password, :roleId, :parentId, :percentage, 'active', true, now())
         RETURNING id`,
        {
          name: person.name,
          email: person.email,
          password: passwordHash,
          roleId: person.roleId,
          parentId,
          percentage: person.percentage,
        },
        transaction
      );

      byName.set(person.name, inserted.id);

      /**
       * The closure table, in the same statement pair as the insert.
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
        { id: inserted.id, parentId },
        transaction
      );

      await exec(
        sequelize,
        `INSERT INTO staff_balances (staff_id, inr, credit_limit, exposure_limit, gt, casino_gt)
         VALUES (:id, 100000, 100000, 100000, 0, 0)
         ON CONFLICT (staff_id) DO NOTHING`,
        { id: inserted.id },
        transaction
      );

      report('created', `${person.email} — role ${person.roleId}, under staff ${parentId}`);
      credentials.staff.push({ email: person.email, role: person.roleId });
    }

    return { agentId: byName.get('demo_agent') };
  },
});

/**
 * Demo players.
 *
 * Ids are random ten-digit numbers, matching `AuthService.#allocateUserId`.
 * `users.id` has no sequence — it is a bigint the application allocates — so a
 * seeder that used `MAX(id) + 1` would produce accounts that look nothing like
 * the ones registration creates, and would collide the moment two ran at once.
 */
DATASETS.push({
  name: 'players',
  group: 'demo',
  description: 'Player accounts with a funded INR balance, wallet row and preferences',
  async run({ sequelize, transaction, config, report, credentials, results }) {
    if (!args.players) {
      report('skipped', '--players 0');
      return;
    }

    const parentStaffId = results.staff?.agentId ?? null;
    const passwordHash = await hashPassword(args.password, config.BCRYPT_ROUNDS);

    let added = 0;
    let present = 0;

    for (let index = 1; index <= args.players; index += 1) {
      const name = `demo_player${String(index).padStart(2, '0')}`;
      const email = `${name}@demo.local`;

      const existing = await one(
        sequelize,
        'SELECT id FROM users WHERE name = :name LIMIT 1',
        { name },
        transaction
      );

      if (existing) {
        present += 1;
        credentials.players.push({ name, id: existing.id, existing: true });
        continue;
      }

      const id = await allocateUserId(sequelize, transaction);

      await exec(
        sequelize,
        `INSERT INTO users
           (id, name, email, password, role_id, status, bet_status, wallet, friends,
            referalcode, created, updated_at, country, wager_multiplier, exposure_limit)
         VALUES
           (:id, :name, :email, :password, 6, 'active', 'active', '{}'::json, 'Support,',
            :referral, now(), now(), 'IN', 3, 100000)`,
        { id, name, email, password: passwordHash, referral: `DEMO${1000 + index}` },
        transaction
      );

      // `credits` is the balance row. A user without one is a user every wallet
      // read returns null for — registration creates it in the same
      // transaction, and so does this.
      await exec(
        sequelize,
        `INSERT INTO credits (uid, inr, usdt)
         VALUES (:id, :inr, 0)
         ON CONFLICT (uid) DO NOTHING`,
        { id, inr: args.balance },
        transaction
      );

      await exec(
        sequelize,
        `INSERT INTO userconfig (uid, email_notifications, push_notifications, theme, language, updatedat)
         VALUES (:id, true, true, 'dark', 'en', now())
         ON CONFLICT (uid) DO NOTHING`,
        { id },
        transaction
      );

      if (parentStaffId) {
        await exec(sequelize, 'UPDATE users SET parent_staff_id = :staffId WHERE id = :id', {
          staffId: parentStaffId,
          id,
        }, transaction);
      }

      added += 1;
      credentials.players.push({ name, id });
    }

    /**
     * Deposit addresses, so the wallet drawer has something to draw.
     *
     * `GET_ADDRESS` is a plain SELECT on `wallets` and answers
     * `{address: null, allocated: false}` when there is no row — there is no
     * generation path in the handler, so without this the drawer's address
     * panel can only ever show its empty state and the QR is never exercised.
     *
     * ── THESE ARE NOT REAL ADDRESSES AND MUST NOT REACH PRODUCTION ────────
     *
     * They are deliberately prefixed `demo1` so that nothing here can be
     * mistaken for a live deposit target, and they are `--demo` only. Money
     * sent to one is gone. Same standard as the fake bank details below.
     *
     * `wallets` is (address, uid, coin, date) — there is **no chain column**,
     * so one address per coin is all the schema can express. That is also why
     * `GET_ADDRESS` throws when a client passes a `chain`, and why the drawer
     * refuses to caption a multi-network coin's address with a network.
     */
    const ADDRESS_COINS = ['usdt', 'btc', 'eth', 'trx'];

    let addresses = 0;
    for (const player of credentials.players) {
      for (const coin of ADDRESS_COINS) {
        const inserted = await one(
          sequelize,
          `INSERT INTO wallets (address, uid, coin, date)
           SELECT :address, :uid, :coin, now()
           WHERE NOT EXISTS (SELECT 1 FROM wallets WHERE uid = :uid AND coin = :coin)
           RETURNING address`,
          {
            // Shaped like an address, unmistakably not one.
            address: `demo1${coin}${String(player.id).slice(-8)}0000000000000000`,
            uid: player.id,
            coin,
          },
          transaction
        );
        if (inserted) addresses += 1;
      }
    }

    if (added) report('created', `${added} player(s), ${args.balance} INR each${parentStaffId ? ` under staff ${parentStaffId}` : ''}`);
    if (present) report('exists', `${present} player(s) already present — password untouched`);
    if (addresses) {
      report('created', `${addresses} deposit address(es) across ${ADDRESS_COINS.join(', ').toUpperCase()}`);
      report('warn', 'Those deposit addresses are FAKE. Money sent to one is lost.');
    }
    if (!parentStaffId && added) {
      report('warn', 'No demo agent found, so the players have no parent staff — run the `staff` dataset too.');
    }
  },
});

DATASETS.push({
  name: 'content',
  group: 'demo',
  description: 'A few published blog posts and platform notices, so the content screens have something in them',
  async run({ sequelize, transaction, report }) {
    const posts = [
      {
        slug: 'welcome-to-ibitplay',
        title: 'Welcome to iBitPlay',
        subheading: 'Casino and sportsbook, one balance.',
        category: 'Announcements',
        description:
          'This is demo content written by scripts/seed-data.js. Replace it from the admin panel — ' +
          'it exists so the blog list, the detail page and the publishing controls have a row to render.',
      },
      {
        slug: 'how-provably-fair-works',
        title: 'How provably fair works',
        subheading: 'Server seed, client seed, nonce.',
        category: 'Guides',
        description:
          'Every in-house round is derived from a hashed server seed committed before you bet, your own ' +
          'client seed, and an incrementing nonce. Demo content — replace before launch.',
      },
      {
        slug: 'responsible-gaming',
        title: 'Responsible gaming',
        subheading: 'Limits, self-exclusion and where to get help.',
        category: 'Policy',
        description: 'Demo content. Replace this with the policy your licence actually requires.',
      },
    ];

    let added = 0;
    let present = 0;

    for (const post of posts) {
      // `blogs_slug_key` is unique, and the slug is the URL — DO NOTHING so a
      // re-run never rewrites a post an operator has edited.
      const row = await insertedRow(
        sequelize,
        `INSERT INTO blogs (slug, title, subheading, description, author, category, date, created_at, updated_at)
         VALUES (:slug, :title, :subheading, :description, 'iBitPlay', :category, now(), now(), now())
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

    /**
     * The announcement feed behind `C.NOTIFICATION`.
     *
     * ═══════════════════════════════════════════════════════════════════
     * `notifications` HAS NO PRIMARY KEY AND NO UNIQUE COLUMN.
     *
     * The baseline declares it as `(title, content, date)` and nothing
     * else, so there is no `ON CONFLICT` target to make the insert
     * idempotent the way the blog posts above are. Re-running this set
     * would otherwise add a second copy of every notice each time.
     *
     * The title is the closest thing to an identity the row has, so it is
     * what the existence check uses. Two DIFFERENT notices that share a
     * title would collapse to one here — acceptable for a demo seeder, and
     * the reason this is not a pattern to copy anywhere that matters.
     * ═══════════════════════════════════════════════════════════════════
     */
    const notices = [
      {
        title: 'Welcome aboard',
        daysAgo: 2,
        content:
          'Great to see you on the site. Check out the offers we have specially for you by clicking here!',
      },
      {
        title: 'Weekly bonus drop',
        daysAgo: 6,
        content: 'Your weekly bonus drop is ready to claim. It expires in 72 hours.',
      },
      {
        title: 'Scheduled maintenance',
        daysAgo: 11,
        content:
          'Wallet services will be briefly unavailable on Sunday between 02:00 and 02:30 UTC.',
      },
    ];

    let notified = 0;
    let noticed = 0;

    for (const notice of notices) {
      const existing = await one(
        sequelize,
        'SELECT title FROM notifications WHERE title = :title LIMIT 1',
        { title: notice.title },
        transaction
      );

      if (existing) {
        noticed += 1;
        continue;
      }

      // Staggered rather than all `now()`: the page renders the date under
      // each notice, and three rows stamped the same second make the column
      // look broken. `daysAgo` is the seeder's, not a column.
      await sequelize.query(
        `INSERT INTO notifications (title, content, date)
         VALUES (:title, :content, now() - (:daysAgo * INTERVAL '1 day'))`,
        { replacements: notice, transaction }
      );
      notified += 1;
    }

    if (notified) report('created', `${notified} notification(s)`);
    if (noticed) report('exists', `${noticed} notification(s) already posted`);
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
         ('INR', 'Demo Bank', '000011112222', 'DEMO0000123', 'iBitPlay Demo', 'demo@upi', true)
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
  say(`  ${cyan('node scripts/seed-data.js')}                       ${dim('config only')}`);
  say(`  ${cyan('node scripts/seed-data.js --demo')}                ${dim('config + demo')}`);
  say(`  ${cyan('node scripts/seed-data.js --only sports,rates')}   ${dim('just these')}`);
  say(`  ${cyan('node scripts/seed-data.js --demo --players 25')}   ${dim('more players')}`);
  say(`  ${cyan('node scripts/seed-data.js --demo --password X')}   ${dim('choose the demo password')}`);
  say('');
}

function chooseDatasets() {
  if (args.only) {
    const chosen = args.only.map((name) => {
      const dataset = DATASETS.find((d) => d.name === name);
      if (!dataset) {
        say(`${red('Unknown dataset')} "${name}". Try ${cyan('--list')}.`);
        process.exit(1);
      }
      return dataset;
    });
    return chosen;
  }

  return DATASETS.filter((d) => d.group === 'config' || (args.demo && d.group === 'demo'));
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

  const chosen = chooseDatasets();
  const wantsDemo = chosen.some((d) => d.group === 'demo');

  /**
   * The production guard.
   *
   * Demo datasets create real accounts with a password this script prints to
   * the terminal. `--force` exists because a staging box legitimately runs with
   * NODE_ENV=production, but it has to be typed.
   */
  if (wantsDemo && config.NODE_ENV === 'production' && !args.force) {
    say(`\n${red('Refusing to seed demo data with NODE_ENV=production.')}`);
    say(`  These are working accounts with a known password: ${bold(args.password)}`);
    say(`\n  ${dim('If this is a staging box, re-run with --force.')}\n`);
    process.exit(1);
  }

  say(`\n${bold('iBitPlay — data runner')}`);
  say(dim(`${config.DB_USER}@${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}  ·  NODE_ENV=${config.NODE_ENV}`));
  say(dim(`${chosen.length} dataset(s): ${chosen.map((d) => d.name).join(', ')}\n`));

  const sequelize = createSequelize(config, logger);
  await authenticate(sequelize, logger);

  const credentials = { staff: [], players: [] };
  const results = {};
  const failures = [];

  for (const dataset of chosen) {
    const lines = [];
    const report = (kind, message) => lines.push({ kind, message });

    say(`${blue(`▸ ${dataset.name}`)} ${dim(dataset.description)}`);

    try {
      const context = { sequelize, config, logger, report, credentials, results };

      // Each dataset in its own transaction, so a failure costs one dataset
      // rather than the whole run. `bootstrap` opts out — Umzug wraps every
      // seeder in a transaction of its own, and nesting them would turn one
      // failed seeder into a rollback of the ones that already succeeded.
      results[dataset.name] = dataset.ownTransaction === false
        ? await dataset.run({ ...context, transaction: undefined })
        : await sequelize.transaction((transaction) => dataset.run({ ...context, transaction }));

      for (const line of lines) {
        if (line.kind === 'warn') say(`  ${yellow('!')} ${yellow(line.message)}`);
        else if (line.kind === 'exists' || line.kind === 'skipped') say(`  ${dim('·')} ${dim(`${line.kind}: ${line.message}`)}`);
        else say(`  ${green('✓')} ${line.message}`);
      }
      if (!lines.length) say(`  ${dim('· nothing to do')}`);
    } catch (error) {
      failures.push({ dataset: dataset.name, error });
      say(`  ${red('✗')} ${red(error.message)}`);
      const cause = error?.parent || error?.original;
      if (cause?.message && cause.message !== error.message) say(`    ${dim(cause.message)}`);
    }

    say('');
  }

  await sequelize.close();

  // ── Summary ──────────────────────────────────────────────────────────

  if (credentials.staff.length || credentials.players.length) {
    const line = '─'.repeat(70);
    say(yellow(line));
    say(yellow(bold('  Demo credentials — password for every account below:')) + ` ${bold(args.password)}`);
    say(yellow(line));

    const note = (account) => (account.existing ? dim('  (pre-existing — its own password)') : '');

    if (credentials.staff.length) {
      say(`\n  ${bold('Staff')} ${dim('— POST /api/v1/admin/auth/login  {"email","password"}')}`);
      for (const account of credentials.staff) {
        say(`    ${account.email.padEnd(30)} ${dim(`role ${account.role}`)}${note(account)}`);
      }
    }

    if (credentials.players.length) {
      say(`\n  ${bold('Players')} ${dim('— POST /api/v1/user/auth/login  {"identifier","password"}')}`);
      for (const account of credentials.players.slice(0, 10)) {
        say(`    ${account.name.padEnd(30)} ${dim(`id ${account.id}`)}${note(account)}`);
      }
      if (credentials.players.length > 10) say(`    ${dim(`… and ${credentials.players.length - 10} more`)}`);
    }
    say(`${yellow(line)}\n`);
  }

  if (failures.length) {
    say(`${red(bold(`${failures.length} dataset(s) failed:`))} ${failures.map((f) => f.dataset).join(', ')}`);
    say(dim('Everything else was committed. Fix the cause and re-run — this script is idempotent.\n'));
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

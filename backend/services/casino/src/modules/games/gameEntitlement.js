'use strict';

const { Op, fn, col, where: sqlWhere } = require('sequelize');
const { entitlements } = require('@ibitplay/common');

const E = require('./games.errors');
const { isProviderDisabled } = require('./providerSwitch');

/**
 * Is this game in the owner's plan? — docs/OWNER-PANEL.md §4.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EVERY LAUNCH ROUTE ASKS, NOT ONLY THE LOBBY
 *
 * The public config masks a non-entitled flag, so the frontend hides the
 * tab — but a launch is one POST with a game id, and a client running its
 * own frontend never looks at the config. Each launch route puts this guard
 * in front of its controller.
 *
 * ── WHICH FLAGS A GAME NEEDS ─────────────────────────────────────────────
 *
 *   a sports or esports BOOK   `sports` AND `sportsbook` (the owner's sportsbook
 *                              mode, off by default). The sportsbook and esports are
 *                              catalogue games launched like any slot, so
 *                              without this the `sports` flag closed the
 *                              in-house feed and left the real book open.
 *                              They are also NOT casino: a site sold sports
 *                              without casino still opens its book.
 *   anything else              `casino`, plus its provider's flag and its
 *                              category's flag when the catalogue row names
 *                              one we know (Providers / Game categories in
 *                              the owner panel).
 *
 * A game we cannot find in either catalogue table still needs `casino` —
 * unknown is not a way around the plan.
 *
 * A row is looked up once per launch: a launch is already an upstream round
 * trip, and a cache here would be one more place for a stale answer.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * The books the frontend launches by uid (`frontend/src/lib/launch.ts` BOOKS
 * and its `.env`), whether or not the catalogue tables carry them. More via
 * `SPORTS_BOOK_GAME_UIDS` (comma-separated) in casino-service's `.env`.
 */
const KNOWN_BOOK_UIDS = [
  '8a704858d5deb4af1ddc722092ac7614', // LuckySports (js-games v2)
  '92b24e4c25107367a80e0fe1a97c24e4', // LuckySports (catalogue row)
  '4ee8e0051a035b463b47c3c473ce317d', // TFGaming esports
  'e130116fdc9bcde2dbb31735b6c365d6', // DPEsportsGaming
];

/** Catalogue `provider` / vendor → the owner panel's Providers flags. */
const PROVIDER_FLAGS = {
  spribe: ['spribe'],
  evolution: ['evolution'],
  pragmatic: ['pragmaticslots'],
  pragmaticslots: ['pragmaticslots'],
  pragmaticplay: ['pragmaticslots'],
  pragmaticlive: ['pragmaticlive'],
  ideal: ['ideal'],
  microgaming: ['microgaming'],
  pgsoft: ['pgsoft'],
  hacksaw: ['hacksawgaming'],
  hacksawgaming: ['hacksawgaming'],
  jili: ['jili', 'jilli'],
  jilli: ['jili', 'jilli'],
  netent: ['netent'],
  // The house's own games (`js_games.vendor = 'in-house'`, played on the in-house
  // engine): the Game categories group's "Originals (in-house)" row.
  inhouse: ['originals'],
};

const SPORTS_PROVIDERS = new Set(['sports', 'esports']);

const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Catalogue `type` → the owner panel's Game categories flag, when it maps cleanly. */
function categoryFlag(type) {
  const t = String(type ?? '').toLowerCase();
  if (!t) return null;
  if (t.includes('crash')) return 'crash';
  if (t.includes('live')) return 'livegames';
  if (t.includes('slot')) return 'slotsgames';
  if (t.includes('lottery')) return 'lotterygames';
  // `India Poker Game` (Teen Patti, Andar Bahar, Rummy, Callbreak…) had an
  // Indian games flag of its own. The site dropped that section; they are card
  // games, so Card games is the switch that closes them now.
  if (t.includes('card') || t.includes('india')) return 'cards';
  return null;
}

function isSportsBook({ provider, type }) {
  return SPORTS_PROVIDERS.has(norm(provider)) || /sport/i.test(String(type ?? ''));
}

/**
 * The flags a game needs, from what is known about it.
 *
 * @param {object} game  { uid?, provider?, type? } — any of them may be missing
 * @param {Set<string>} bookUids
 */
function flagsFor(game, bookUids) {
  if ((game.uid && bookUids.has(String(game.uid).toLowerCase())) || isSportsBook(game)) return ['sports', 'sportsbook'];
  const flags = ['casino', ...(PROVIDER_FLAGS[norm(game.provider)] ?? [])];
  const category = categoryFlag(game.type);
  if (category) flags.push(category);
  return flags;
}

/** The catalogue row for a uid: the GIS table first, then js-games. Null when neither has it. */
async function lookup(models, uid) {
  if (!uid) return null;
  const gis = await models.Gisgamesnew?.findOne({ where: { uuid: uid }, attributes: ['provider', 'type'], raw: true });
  if (gis) return { provider: gis.provider, type: gis.type };
  const js = await models.JsGames?.findOne({ where: { game_uid: uid }, attributes: ['vendor', 'game_type'], raw: true });
  if (js) return { provider: js.vendor, type: js.game_type };
  return null;
}

/**
 * Express guard for a launch route.
 *
 * @param {object}   deps   the container (`models`, `config`)
 * @param {Function} pick   req → { uid?, provider?, type? } from the validated body
 * @param {boolean}  [opts.mustExist]  the uid must be a live catalogue row (gisgamesnew / js_games):
 *   a parked or unknown uid would otherwise pass on the `casino` flag alone and open upstream
 */
function requireGameEntitled({ models, config } = {}, pick, { mustExist = false } = {}) {
  const bookUids = new Set(
    [...KNOWN_BOOK_UIDS, ...String(config?.SPORTS_BOOK_GAME_UIDS ?? '').split(',')]
      .map((uid) => uid.trim().toLowerCase())
      .filter(Boolean)
  );

  return async function gameEntitledGuard(req, _res, next) {
    try {
      if (req.user?.id && models?.Users) {
        const player = await models.Users.findByPk(req.user.id, { attributes: ['is_demo'], raw: true });
        if (player?.is_demo) throw E.DEMO_NOT_ALLOWED();
      }
      const given = pick(req) ?? {};
      const row = await lookup(models ?? {}, given.uid);
      if (mustExist && given.uid && !row && !bookUids.has(String(given.uid).toLowerCase())) throw E.NOT_FOUND({ uid: given.uid });
      const game = { uid: given.uid, provider: row?.provider ?? given.provider, type: row?.type ?? given.type };
      for (const flag of flagsFor(game, bookUids)) await entitlements.assertFlagEntitled(flag);
      /**
       * The site admin's own switch (Casino → Providers, migration 067), after
       * the owner's plan: the plan says what the site MAY offer, the switch
       * what it does. The lobby already hides the provider; this refuses the
       * stale tile, the bookmark and the hand-written POST.
       */
      if (game.provider && (await isProviderDisabled(models, game.provider))) {
        throw E.PROVIDER_DISABLED({ provider: game.provider });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE LISTS, NOT ONLY THE LAUNCH
 *
 * A game the launch refuses must not sit in the lobby either: the catalogue
 * lists (`js-games/v1/games`, its search, the curated collections) drop every
 * row whose provider or category flag the owner took out of the plan, and a
 * list asked for BY a switched-off vendor (`?vendor=in-house` with Originals
 * off) answers 403 NOT_ENTITLED like the launch. `casino` itself is not
 * applied to the lists: the books are catalogue rows too and need only
 * `sports`.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Category flag → the `game_type` substrings `categoryFlag` reads it from. */
const CATEGORY_PATTERNS = {
  crash: ['crash'],
  livegames: ['live'],
  slotsgames: ['slot'],
  lotterygames: ['lottery'],
  cards: ['card', 'india'],
};

/** The flags the owner switched off, from the document. */
const offFlags = (doc) =>
  new Set(Object.entries(doc?.flags ?? {}).filter(([, on]) => on === false).map(([key]) => key));

/** Normalised vendor keys (`norm`) whose provider flag is off. */
function blockedVendors(off) {
  return Object.entries(PROVIDER_FLAGS)
    .filter(([, flags]) => flags.some((flag) => off.has(flag)))
    .map(([vendor]) => vendor);
}

/** Is this catalogue row (`{vendor, game_type}`) in the plan? Sync, for code holding the document. */
function isRowEntitledIn(doc, row) {
  const off = offFlags(doc);
  // A book is the sportsbook: it needs the owner's sportsbook mode too (off by default).
  if (isSportsBook({ provider: row?.vendor, type: row?.game_type })) return !off.has('sports') && entitlements.flagOnIn(doc, 'sportsbook');
  if (!off.size) return true;
  const flags = [...(PROVIDER_FLAGS[norm(row?.vendor)] ?? [])];
  const category = categoryFlag(row?.game_type);
  if (category) flags.push(category);
  return !flags.some((flag) => off.has(flag));
}

/**
 * Sequelize conditions (to AND into a `js_games` where) that drop the rows
 * outside the plan; `[]` when nothing is off. Same mapping as the launch.
 */
async function catalogueConditions() {
  const off = offFlags(await entitlements.getEntitlements());
  if (!off.size) return [];
  const conditions = [];
  const vendors = blockedVendors(off);
  if (vendors.length) {
    conditions.push({
      [Op.or]: [
        { vendor: null },
        sqlWhere(fn('lower', fn('regexp_replace', col('vendor'), '[^A-Za-z0-9]', '', 'g')), { [Op.notIn]: vendors }),
      ],
    });
  }
  for (const [flag, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (!off.has(flag)) continue;
    for (const pattern of patterns) {
      conditions.push({ [Op.or]: [{ game_type: null }, { game_type: { [Op.notILike]: `%${pattern}%` } }] });
    }
  }
  return conditions;
}

/** A list filtered BY vendor: 403 NOT_ENTITLED when that provider is out of the plan. */
async function assertVendorEntitled(vendor) {
  if (!vendor) return;
  for (const flag of PROVIDER_FLAGS[norm(vendor)] ?? []) await entitlements.assertFlagEntitled(flag);
}

/**
 * The in-house engine's stake (sockets → `GameEngine.placeBet`): `casino`,
 * `originals` and the game's category (crash). Open rounds still settle and
 * cash out — only a NEW stake is refused, so nobody's money is stranded.
 */
async function assertInHouseEntitled(gameKey) {
  for (const flag of flagsFor({ provider: 'in-house', type: gameKey }, new Set())) {
    await entitlements.assertFlagEntitled(flag);
  }
}

module.exports = {
  requireGameEntitled,
  flagsFor,
  KNOWN_BOOK_UIDS,
  isRowEntitledIn,
  catalogueConditions,
  assertVendorEntitled,
  assertInHouseEntitled,
};

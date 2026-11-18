'use strict';

const { buildGisService } = require('../gis/gis.factory');
const { buildJsGamesService } = require('../js-games/jsGames.factory');
const { LIVE, JS_ALWAYS_LIVE, chosenAggregator } = require('./catalogueSwitch');
const { MOBILE_SUFFIX } = require('./games.service');
const { KNOWN_BOOK_UIDS } = require('./gameEntitlement');
const E = require('./games.errors');

/**
 * The only providers JSGames V2 is allowed to open — the studios the owner runs through JSGames
 * because Slotegrator does not carry them (`catalogueSwitch.js` keeps the same set in the lobby).
 * A JSGames catalogue game of any other provider — a parked studio reached by an old link or a
 * stale favourite — is refused here, so turning a provider off in the lobby also closes its launch.
 * The sports/esports books are exempt: they are JSGames uids that are not catalogue tiles.
 */
const JS_ALLOWED_PROVIDERS = new Set(JS_ALWAYS_LIVE);

/** The sports/esports book uids, which launch through JSGames V2 whatever the lobby serves. */
function bookUids({ config } = {}) {
  return new Set(
    [...KNOWN_BOOK_UIDS, ...String(config?.SPORTS_BOOK_GAME_UIDS ?? '').split(',')]
      .map((uid) => uid.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * May this JSGames launch go ahead? Under the JSGames policy every row in the live lobby is the
 * owner's choice. Under Slotegrator only the always-live studios stay, and any other row is parked.
 * A uid outside the lobby opens only when it is a configured book.
 */
function mayOpenJsGame({ row, provider, isBook, aggregator }) {
  if (!row) return isBook;
  return aggregator === 'js_games' || JS_ALLOWED_PROVIDERS.has(provider);
}

/**
 * One launch for any lobby game — `POST /casino/games/launch`.
 *
 * The lobby's catalogue holds the owner's aggregator's games (`catalogueSwitch.js`), and each
 * row says whose it is (`gisgamesnew.aggregator`). The front end does not need to know: a
 * Slotegrator row opens through the GIS module, anything else — including the sportsbook and
 * esports books, which are JSGames uids whatever the lobby serves — through JSGames V2.
 *
 * Both paths keep their own guards (casino lock, currency, recently-played); this only picks.
 * Answers `{ gameLaunchUrl, via, sessionId? }`, the JSGames shape the front end already reads.
 */

/** The live lobby row for a uuid, or null — its aggregator and provider. */
async function lobbyRow({ db }, gameUuid) {
  try {
    const [[row]] = await db.sequelize.query(
      `SELECT aggregator, provider FROM ${LIVE} WHERE uuid = :uuid LIMIT 1`,
      { replacements: { uuid: gameUuid } }
    );
    return row ?? null;
  } catch {
    // Before migration 097 there is no aggregator column.
    return null;
  }
}

/** Whose game a uuid is: `'slotegrator'` or `'js_games'` (also for a uid not in the lobby). */
async function aggregatorOf(deps, gameUuid) {
  const row = await lobbyRow(deps, gameUuid);
  return row?.aggregator === 'slotegrator' ? 'slotegrator' : 'js_games';
}

/**
 * The row to open on this device. Slotegrator lists "Le Bandit" (desktop) and "Le Bandit Mobile"
 * as two games; the lobby shows only the desktop tile (games.service `NOT_A_MOBILE_TWIN`), so
 * a phone launching it is switched to the Mobile twin, and a desktop launching a Mobile uuid
 * (an old link, a favourite) to its desktop twin. No twin: the uuid as given.
 */
async function deviceVariant({ db }, gameUuid, device) {
  const wantMobile = device === 'mobile';
  try {
    const [[row]] = await db.sequelize.query(
      `SELECT twin.uuid FROM ${LIVE} g JOIN ${LIVE} twin ON twin.provider = g.provider AND twin.uuid <> g.uuid
        WHERE g.uuid = :uuid AND (
          (:wantMobile AND g.name !~* :suffix AND LOWER(twin.name) = LOWER(g.name) || ' mobile')
          OR (NOT :wantMobile AND g.name ~* :suffix AND LOWER(twin.name) = LOWER(REGEXP_REPLACE(g.name, :suffix, '', 'i'))))
        LIMIT 1`,
      { replacements: { uuid: gameUuid, wantMobile, suffix: MOBILE_SUFFIX } }
    );
    return row?.uuid ?? gameUuid;
  } catch {
    return gameUuid;
  }
}

async function launchGame(deps, { userId, gameUuid: requested, currencyCode, device, language }) {
  const row = await lobbyRow(deps, requested);

  if (row?.aggregator === 'slotegrator') {
    const gameUuid = await deviceVariant(deps, requested, device);
    const user = await deps.models.Users.findByPk(userId, { attributes: ['id', 'name'], raw: true });
    const { url, sessionId } = await buildGisService(deps).launch({
      userId,
      gameUuid,
      playerName: String(user?.name || userId),
      currency: currencyCode,
      device,
      language,
    });
    return { gameLaunchUrl: url, via: 'slotegrator', sessionId };
  }

  /**
   * JSGames V2 — but only for the allowed studios, or a sports/esports book.
   *
   * A catalogue tile (`row` is set) must be one of `JS_ALLOWED_PROVIDERS`: a parked provider's
   * game, reached by an old link or a stale favourite, is refused here even though its row
   * would otherwise fall through to JSGames. A uid that is NOT a lobby tile is allowed only
   * when it is a configured book; anything else is not in the lobby and cannot be launched.
   */
  const provider = String(row?.provider ?? '').trim().toLowerCase();
  const isBook = bookUids(deps).has(String(requested).toLowerCase());
  const aggregator = row ? await chosenAggregator(deps.models) : null;
  if (!mayOpenJsGame({ row, provider, isBook, aggregator })) {
    throw E.NOT_FOUND({ uuid: requested });
  }

  const result = await buildJsGamesService(deps).launchV2({ userId, gameUid: requested, currencyCode, language });
  return { ...result, via: 'jsgames-v2' };
}

module.exports = { aggregatorOf, deviceVariant, launchGame, mayOpenJsGame };

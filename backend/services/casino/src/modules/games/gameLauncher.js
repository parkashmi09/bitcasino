'use strict';

const { buildGisService } = require('../gis/gis.factory');
const { buildJsGamesService } = require('../js-games/jsGames.factory');
const { LIVE } = require('./catalogueSwitch');
const { MOBILE_SUFFIX } = require('./games.service');

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

/** Whose game a uuid is: `'slotegrator'` or `'js_games'` (also for a uid not in the lobby). */
async function aggregatorOf({ db }, gameUuid) {
  try {
    const [[row]] = await db.sequelize.query(`SELECT aggregator FROM ${LIVE} WHERE uuid = :uuid LIMIT 1`, {
      replacements: { uuid: gameUuid },
    });
    return row?.aggregator === 'slotegrator' ? 'slotegrator' : 'js_games';
  } catch {
    // Before migration 097 there is no column: every lobby game is a JSGames one.
    return 'js_games';
  }
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
  if ((await aggregatorOf(deps, requested)) === 'slotegrator') {
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
  const result = await buildJsGamesService(deps).launchV2({ userId, gameUid: requested, currencyCode, language });
  return { ...result, via: 'jsgames-v2' };
}

module.exports = { aggregatorOf, deviceVariant, launchGame };

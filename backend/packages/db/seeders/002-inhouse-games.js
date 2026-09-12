'use strict';

/**
 * Register the in-house games this platform resolves itself.
 *
 * `bets.gid` is NOT NULL — every bet must point at a real game row. Provider
 * games already have one; the in-house games (dice, crash, limbo, coinflip)
 * are settled by casino-service and need catalogue entries of their own.
 *
 * `game_uid` is the stable key the service looks up, so the numeric id can
 * differ per environment without any code depending on it.
 */

const IN_HOUSE_GAMES = [
  { game_uid: 'dice', game_name: 'Dice', game_type: 'dice', vendor: 'in-house' },
  { game_uid: 'crash', game_name: 'Crash', game_type: 'crash', vendor: 'in-house' },
  { game_uid: 'limbo', game_name: 'Limbo', game_type: 'limbo', vendor: 'in-house' },
  { game_uid: 'coinflip', game_name: 'Coin Flip', game_type: 'coinflip', vendor: 'in-house' },
];

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  for (const game of IN_HOUSE_GAMES) {
    const [existing] = await sequelize.query('SELECT id FROM js_games WHERE game_uid = :uid LIMIT 1', {
      replacements: { uid: game.game_uid },
      type: QueryTypes.SELECT,
      transaction,
    });

    if (existing) {
      logger?.info(`In-house game "${game.game_uid}" already registered (id ${existing.id})`);
      continue;
    }

    const [inserted] = await sequelize.query(
      `INSERT INTO js_games (game_name, game_uid, game_type, is_active, vendor, created_at, updated_at)
       VALUES (:game_name, :game_uid, :game_type, true, :vendor, now(), now())
       RETURNING id`,
      { replacements: game, type: QueryTypes.SELECT, transaction }
    );

    logger?.info(`Registered in-house game "${game.game_uid}" (id ${inserted.id})`);
  }
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DELETE FROM js_games WHERE vendor = :vendor', {
    replacements: { vendor: 'in-house' },
    transaction,
  });
}

module.exports = { up, down, IN_HOUSE_GAMES };

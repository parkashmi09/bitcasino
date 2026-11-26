'use strict';

/**
 * Parent side: the JSGames V2 player id of each whitelabel copy's player.
 *
 * JSGames takes a player id of digits only, 11 at most, so a copy's player cannot be named
 * `wl<id>_<player>` the way Slotegrator and original games name them — and a copy's own ids
 * (10 digits) leave no room for a prefix. The parent issues each (whitelabel, player) a numeric
 * alias here at first launch; JSGames knows the player by it, and a bet callback carrying it is
 * passed on to that copy (casino-service modules/wl-hub `jsAlias`, `jsPlayerByAlias`).
 *
 * Aliases start at 10 000 000 000 — 11 digits, above every 10-digit player id of the parent's
 * own — so a callback's id alone says whether it is the parent's player or a copy's.
 */
async function up({ sequelize, transaction, logger }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(`CREATE SEQUENCE IF NOT EXISTS whitelabel_js_players_alias_seq AS BIGINT START WITH 10000000000 MINVALUE 10000000000 MAXVALUE 99999999999 NO CYCLE`);
  await q(
    `CREATE TABLE IF NOT EXISTS whitelabel_js_players (
       alias          BIGINT       PRIMARY KEY DEFAULT nextval('whitelabel_js_players_alias_seq'),
       whitelabel_id  INTEGER      NOT NULL REFERENCES whitelabels (id),
       player_id      VARCHAR(20)  NOT NULL,
       created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       UNIQUE (whitelabel_id, player_id)
     )`
  );
  await q(`ALTER SEQUENCE whitelabel_js_players_alias_seq OWNED BY whitelabel_js_players.alias`);
  logger?.info('Created whitelabel_js_players');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`DROP TABLE IF EXISTS whitelabel_js_players`, { transaction });
  await sequelize.query(`DROP SEQUENCE IF EXISTS whitelabel_js_players_alias_seq`, { transaction });
}

module.exports = { up, down };

'use strict';

/**
 * Profile medals: which medal each player holds, and since when.
 *
 *   user_medals (user_id, medal_type, sub_type)   one row per medal held
 *     unlocked_at   when the platform first saw the rule met (Old-Timer: the
 *                   account's first anniversary itself)
 *
 * The catalogue (titles, rules, thresholds) is code — `services/user/src/
 * modules/medals/medals.constants.js` — keyed by the reference site's own medal
 * `type` + `subType`, so the front-end's artwork resolves unchanged. Only the
 * fact of holding a medal is stored: progress is computed on read from the data
 * the rule measures, and a row is written the first time a read finds the rule
 * met. A medal once earned is kept, even if the measured figure later drops (a
 * "highest wager ever" record passed by someone else).
 *
 * `sub_type` is '0' for every medal except the per-coin TOP 1 family (type 17,
 * BTC / DOGE / EOS / ETH), the reference's own encoding.
 *
 * Cosmetic: nothing here pays, so there is no ledger link.
 *
 * Idempotent (`IF NOT EXISTS`). `down` drops the table.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_medals (
       user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       medal_type   smallint NOT NULL,
       sub_type     varchar(8) NOT NULL DEFAULT '0',
       unlocked_at  timestamp with time zone NOT NULL DEFAULT now(),
       PRIMARY KEY (user_id, medal_type, sub_type),
       CONSTRAINT user_medals_type_chk CHECK (medal_type BETWEEN 1 AND 99)
     )`,
    { transaction }
  );
  /* Holder counts per medal ("N players have this") group by the medal. */
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS ix_user_medals_medal ON user_medals (medal_type, sub_type)',
    { transaction }
  );
  logger?.info('Created user_medals');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS user_medals', { transaction });
}

module.exports = { up, down };

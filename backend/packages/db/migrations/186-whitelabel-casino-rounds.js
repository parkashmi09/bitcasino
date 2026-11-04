'use strict';

/**
 * Parent side: every casino wallet callback (Slotegrator, original games) the parent passed on to
 * a whitelabel copy and the copy accepted — the parent's own record of what each copy's players
 * staked and won on the parent's provider accounts, for the GGR revenue-share report
 * (casino-service modules/wl-hub, docs/plans/2026-11-01-whitelabel-plan-and-casino-hub.md Part B/D).
 *
 *   kind     bet | win | refund | rollback   (product = 'casino' for Slotegrator, 'originals' for original games)
 *   amount   the callback's amount in its currency; a rollback's is what it reversed (bets − wins)
 *
 * One row per provider transaction and kind: a provider retry is not a second round.
 */

async function up({ sequelize, transaction, logger }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(
    `CREATE TABLE IF NOT EXISTS whitelabel_casino_rounds (
       id              BIGSERIAL     PRIMARY KEY,
       whitelabel_id   INTEGER       NOT NULL REFERENCES whitelabels (id),
       product         VARCHAR(12)   NOT NULL CHECK (product IN ('casino', 'originals')),
       provider        VARCHAR(20)   NOT NULL,
       kind            VARCHAR(10)   NOT NULL CHECK (kind IN ('bet', 'win', 'refund', 'rollback')),
       transaction_id  VARCHAR(128)  NOT NULL,
       player_id       VARCHAR(40)   NOT NULL,
       game            VARCHAR(128),
       currency        VARCHAR(10)   NOT NULL,
       amount          NUMERIC(30,8) NOT NULL DEFAULT 0,
       created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
     )`
  );
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS whitelabel_casino_rounds_tx ON whitelabel_casino_rounds (provider, transaction_id, kind)`);
  await q(`CREATE INDEX IF NOT EXISTS whitelabel_casino_rounds_wl ON whitelabel_casino_rounds (whitelabel_id, created_at)`);
  logger?.info('Created whitelabel_casino_rounds');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`DROP TABLE IF EXISTS whitelabel_casino_rounds`, { transaction });
}

module.exports = { up, down };

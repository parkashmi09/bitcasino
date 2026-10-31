'use strict';

/**
 * Peer-to-peer tips — one player sends part of their balance to another by username.
 *
 * `tips` is the record of the transfer itself; the money moves through the wallet spine
 * (`WalletService.debit` / `credit`), so every tip also has two `credits_ledger` rows —
 * `TIP_SENT` on the sender, `TIP_RECEIVED` on the receiver — whose ids are kept here
 * (`from_ledger_id`, `to_ledger_id`). The row and both ledger rows commit together.
 *
 *   from_user_id / to_user_id   the two players (`users.id`)
 *   currency                    a built-in wallet coin (custom coins are refused for tips)
 *   amount                      > 0
 *   note                        optional, up to 140 characters
 *
 * The per-player switch lives on `userconfig` (preferences), not `users`: it is a player's own
 * opt-out like the notification toggles there. A player with no `userconfig` row reads as ON
 * (the column default), so every existing player can receive tips until they turn it off.
 *
 * The site's own feature row (`site_features.tips`) is seeded ON so the player site shows the
 * feature out of the box; the owner's plan still decides (a missing key = entitled), and an
 * existing row is never touched.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS tips (
       id              bigserial PRIMARY KEY,
       from_user_id    bigint NOT NULL,
       to_user_id      bigint NOT NULL,
       currency        varchar(16) NOT NULL,
       amount          numeric(36,18) NOT NULL,
       note            varchar(140),
       from_ledger_id  bigint,
       to_ledger_id    bigint,
       created_at      timestamp with time zone NOT NULL DEFAULT now(),
       CONSTRAINT tips_amount_chk CHECK (amount > 0),
       CONSTRAINT tips_not_self_chk CHECK (from_user_id <> to_user_id)
     )`,
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS ix_tips_from_created ON tips (from_user_id, created_at DESC)',
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS ix_tips_to_created ON tips (to_user_id, created_at DESC)',
    { transaction }
  );

  await sequelize.query(
    'ALTER TABLE userconfig ADD COLUMN IF NOT EXISTS tips_enabled boolean NOT NULL DEFAULT true',
    { transaction }
  );

  await sequelize.query(
    `INSERT INTO site_features (feature, enabled, variant, config, secrets, updated_by, created_at, updated_at)
     VALUES ('tips', true, 'peer_to_peer', '{}'::jsonb, '{}'::jsonb, 'migration:077-tips', now(), now())
     ON CONFLICT (feature) DO NOTHING`,
    { transaction }
  );

  logger?.info('Created tips; added userconfig.tips_enabled; seeded site_features.tips ON');
}

async function down({ sequelize, transaction }) {
  await sequelize.query("DELETE FROM site_features WHERE feature = 'tips' AND updated_by = 'migration:077-tips'", { transaction });
  await sequelize.query('ALTER TABLE userconfig DROP COLUMN IF EXISTS tips_enabled', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS tips', { transaction });
}

module.exports = { up, down };

'use strict';

/**
 * The bonus balance and its wagering lock.
 *
 * Until now every bonus (first-deposit, spin wheel) was a plain `BONUS` credit into the cash
 * wallet. The rollover was written on the ledger row and nothing enforced it, so a bonus could be
 * withdrawn the minute it landed.
 *
 * ── STORAGE: ONE ROW PER BONUS, NO SECOND BALANCE COLUMN ────────────────
 *
 * `player_bonuses` holds one row per granted bonus. A player's BONUS BALANCE is the sum of their
 * `active` rows, per `currency` (the reward currency at the moment the bonus was granted, like
 * every other reward row). There is deliberately no `credits.bonus_*` column or `wallet_balances`
 * row: a stored total next to the rows would be a second number that can drift from them, and the
 * cash wallet's every-movement-has-a-ledger-row rule would have to be re-proved for it.
 *
 * Bonus money is LOCKED UNTIL WAGERED: it is not in the cash wallet, so no bet, withdrawal, swap
 * or vault deposit can spend it. When `wagered >= required_wager` the row's `amount` is credited
 * to cash (a `BONUS` ledger row, key `player-bonus:<id>`, its id kept in `release_ledger_id`) and
 * the row becomes `completed`, in one transaction.
 *
 *   source            first_deposit | spin_wheel (later others)
 *   grant_key         unique: what makes a grant exactly-once (`first-deposit-bonus:<uid>`,
 *                     `spin-wheel-bonus:<source>:<refId>`), the same keys the cash credits used
 *   ref               the deposit / claim it came from ("FIAT_DEPOSIT:11")
 *   wager_multiplier  the rollover the operator configured for that source when it was granted
 *   required_wager    amount × wager_multiplier, in `currency`
 *   wagered           counted so far, in `currency`
 *   status            active | completed | expired | forfeited
 *   expires_at        an active bonus past this is expired (worker job + lazily on read)
 *   ended_at / end_reason / ended_by   when and why it stopped being active (staff id for a
 *                     manual forfeit)
 *
 * `player_bonus_wagers` — which stake moved which bonus, by how much (`amount` in the bonus's
 * currency). Unique per `(bonus_id, source, ref)`, so a retried stake cannot count twice, and a
 * refund / rollback (`POST /internal/user/wager/reverse`) finds exactly what to take back out.
 *
 * Per-source terms:
 *   siteconfig.first_deposit_bonus_expiry_days   days an unwagered first-deposit bonus lives (30)
 *   spin_wheel_config.wager_multiplier           the spin bonus's rollover (null = the
 *                                                first-deposit multiplier, as before)
 *   spin_wheel_config.bonus_expiry_days          days an unwagered spin bonus lives (30)
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS player_bonuses (
       id                bigserial PRIMARY KEY,
       user_id           bigint NOT NULL,
       source            varchar(40) NOT NULL,
       grant_key         varchar(190) NOT NULL,
       ref               varchar(120),
       amount            numeric(30,8) NOT NULL,
       currency          varchar(20) NOT NULL,
       wager_multiplier  numeric(10,2) NOT NULL DEFAULT 0,
       required_wager    numeric(30,8) NOT NULL DEFAULT 0,
       wagered           numeric(30,8) NOT NULL DEFAULT 0,
       status            varchar(20) NOT NULL DEFAULT 'active',
       expires_at        timestamp with time zone,
       granted_at        timestamp with time zone NOT NULL DEFAULT now(),
       completed_at      timestamp with time zone,
       ended_at          timestamp with time zone,
       end_reason        varchar(60),
       ended_by          bigint,
       release_ledger_id bigint,
       description       text,
       CONSTRAINT player_bonuses_status_chk CHECK (status IN ('active','completed','expired','forfeited')),
       CONSTRAINT player_bonuses_amount_chk CHECK (amount > 0)
     )`,
    { transaction }
  );
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_player_bonuses_grant_key ON player_bonuses (grant_key)',
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS ix_player_bonuses_user_status ON player_bonuses (user_id, status, granted_at, id)',
    { transaction }
  );
  await sequelize.query(
    "CREATE INDEX IF NOT EXISTS ix_player_bonuses_active_expiry ON player_bonuses (expires_at) WHERE status = 'active'",
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS player_bonus_wagers (
       id           bigserial PRIMARY KEY,
       bonus_id     bigint NOT NULL REFERENCES player_bonuses(id) ON DELETE CASCADE,
       user_id      bigint NOT NULL,
       source       varchar(40) NOT NULL,
       ref          varchar(190) NOT NULL,
       amount       numeric(30,8) NOT NULL,
       created_at   timestamp with time zone NOT NULL DEFAULT now(),
       reversed_at  timestamp with time zone
     )`,
    { transaction }
  );
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_player_bonus_wagers_stake ON player_bonus_wagers (bonus_id, source, ref)',
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS ix_player_bonus_wagers_ref ON player_bonus_wagers (source, ref)',
    { transaction }
  );

  await sequelize.query(
    'ALTER TABLE siteconfig ADD COLUMN IF NOT EXISTS first_deposit_bonus_expiry_days integer DEFAULT 30 NOT NULL',
    { transaction }
  );
  await sequelize.query(
    'ALTER TABLE spin_wheel_config ADD COLUMN IF NOT EXISTS wager_multiplier numeric(10,2)',
    { transaction }
  );
  await sequelize.query(
    'ALTER TABLE spin_wheel_config ADD COLUMN IF NOT EXISTS bonus_expiry_days integer DEFAULT 30 NOT NULL',
    { transaction }
  );
  logger?.info('Created player_bonuses / player_bonus_wagers; added bonus expiry and spin multiplier settings');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE spin_wheel_config DROP COLUMN IF EXISTS bonus_expiry_days', { transaction });
  await sequelize.query('ALTER TABLE spin_wheel_config DROP COLUMN IF EXISTS wager_multiplier', { transaction });
  await sequelize.query('ALTER TABLE siteconfig DROP COLUMN IF EXISTS first_deposit_bonus_expiry_days', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS player_bonus_wagers', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS player_bonuses', { transaction });
}

module.exports = { up, down };

'use strict';

/**
 * `user_withdrawal_whitelist` — the addresses a player has approved to
 * withdraw to, and the switch that makes the list binding.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A SETTINGS PANE WITH NOTHING BEHIND IT
 *
 * The front-end has Settings → Whitelist Management, and the withdraw form has
 * an address field that accepts anything typed into it. There is no table, no
 * route and no column anywhere on this platform — `bank_details` is the
 * nearest thing and it is saved BANK ACCOUNTS for fiat payouts, a different
 * rail and a different shape. Legacy had nothing either.
 *
 * ── WHY THE MASTER SWITCH IS ON `users` AND NOT `userconfig` ─────────────
 *
 * `userconfig` is preferences — theme, language, notification opt-ins,
 * `hide_balance`. This is not a preference: with it on, a withdrawal to an
 * address that is not on the list is REFUSED. That is a security control, and
 * `users` is where this schema already keeps them — `is_locked`,
 * `casino_locked`, `system_locked`, `sports_betlocked`, `bet_status`.
 *
 * It also settles ownership. Two modules writing `userconfig` is how a
 * preference write and a security write end up racing; the whitelist module
 * owns this column and nothing else touches it.
 *
 * ── DEFAULT `false`, WHICH IS THE PERMISSIVE SIDE, DELIBERATELY ──────────
 *
 * Every existing account gets `false`, so nobody's withdrawals start failing
 * the moment this migration runs. A player turns it on once they have added an
 * address — and the service refuses to turn it on against an EMPTY list, which
 * is the one way this could lock somebody out of their own money.
 *
 * ── THE ADDRESS IS NOT VALIDATED AGAINST A CHAIN ─────────────────────────
 *
 * No checksum, no per-network format rule. The platform supports 28 currencies
 * across chains whose address formats differ, no provider is configured to ask
 * (see the deployment notes), and a wrong-format address that is REFUSED at
 * withdrawal time is a better failure than one refused at save time by a rule
 * this port would have had to invent. The length cap and the character class
 * bound what can be stored; correctness is the payment provider's answer to
 * give.
 *
 * ── UNIQUE PER (user, currency, address) ─────────────────────────────────
 *
 * Not per (user, address): the same string can be a valid address on more than
 * one chain, and a player who withdraws USDT on two networks legitimately has
 * it twice. The label is free text and is not part of the key.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_withdrawal_whitelist (
       id         BIGSERIAL    PRIMARY KEY,
       user_id    BIGINT       NOT NULL,
       -- What the player calls it. Free text, shown in the picker.
       label      VARCHAR(60)  NOT NULL,
       -- The wallet currency this address is for, e.g. 'USDT'.
       currency   VARCHAR(20)  NOT NULL,
       -- The chain, where the currency has more than one, e.g. 'TRC20'.
       -- Nullable: a single-chain currency has nothing to say here.
       network    VARCHAR(40),
       address    VARCHAR(190) NOT NULL,
       -- Destination tag / memo. Required by some chains, absent on most.
       memo       VARCHAR(120),
       created_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS user_withdrawal_whitelist_uniq
       ON user_withdrawal_whitelist (user_id, currency, address)`,
    { transaction }
  );

  // "My addresses, newest first" — the only read there is.
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_user_withdrawal_whitelist_user
       ON user_withdrawal_whitelist (user_id, created_at DESC)`,
    { transaction }
  );

  /**
   * The switch. `IF NOT EXISTS` and a default, which is the shape migrations
   * 034, 035 and 037 use for exactly this — idempotent, and existing rows keep
   * working without a backfill.
   */
  await sequelize.query(
    `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS withdraw_whitelist_only BOOLEAN NOT NULL DEFAULT false`,
    { transaction }
  );

  logger?.info('Created user_withdrawal_whitelist and users.withdraw_whitelist_only');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this discards every withdrawal address every player has saved, ' +
        'and turns off a control some of them rely on. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS user_withdrawal_whitelist', { transaction });
  await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS withdraw_whitelist_only', { transaction });
  logger?.warn('Dropped user_withdrawal_whitelist and users.withdraw_whitelist_only');
}

module.exports = { up, down };

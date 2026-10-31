'use strict';

/**
 * `users.withdraw_locked_until` — the 24-hour withdrawal freeze that follows a
 * password change.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A DIALOG THAT STATED A FACT NOTHING WAS ENFORCING
 *
 * bc.game puts a confirm in front of Change Password — "Account Restrictions",
 * `account2.setting.protect.tips` in the account remote's i18n bundle:
 *
 *   In order to protect your account safety, we will disable your withdrawals
 *   for __restime__ hours after you change your __restype__.
 *
 * 24 hours for a password, 48 for an e-mail or phone change. The front-end
 * port of that dialog would otherwise be the first screen in this project to
 * promise a security measure the server does not take — and unlike a dead CSS
 * class, a false promise about money is not something to reproduce faithfully.
 * So the rule is implemented and the dialog tells the truth.
 *
 * ── WHY IT IS A TIMESTAMP AND NOT A BOOLEAN ──────────────────────────────
 *
 * The window has to expire on its own. A flag would need a sweeper to clear
 * it, and a sweeper that does not run is an account frozen forever; a
 * timestamp in the past is simply not a lock. Nothing has to remember to
 * unset it, and the guards read `now < withdraw_locked_until`.
 *
 * It also carries the one fact the refusal has to state — WHEN the player can
 * withdraw again — which a boolean cannot.
 *
 * ── WHY IT LIVES ON `users` ──────────────────────────────────────────────
 *
 * The same argument migration 039 makes for `withdraw_whitelist_only`: this is
 * a security control, not a preference, and `users` is where this schema keeps
 * them (`is_locked`, `casino_locked`, `system_locked`, `sports_betlocked`).
 * `userconfig` is theme and notification opt-ins.
 *
 * ── NULL BY DEFAULT, WHICH IS THE PERMISSIVE SIDE ────────────────────────
 *
 * Nobody's withdrawals start failing when this migration runs. The column
 * fills only when a player changes their own password from that moment on.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * It is not set by an ADMIN password reset or by the forgot-password flow.
 * Both are worth arguing about — a reset is the likelier attacker path, which
 * is the case FOR covering it, while an operator resetting a locked-out
 * player's password and then freezing their withdrawals for a day is a support
 * problem. bc.game's own dialog is on the self-service change and only there,
 * so that is what is reproduced. Widening it is one call to the same helper.
 */

async function up({ sequelize, transaction, logger }) {
  /**
   * `IF NOT EXISTS` and nullable — the shape migrations 034, 035, 037 and 039
   * use for exactly this, so a re-run is a no-op and existing rows need no
   * backfill.
   */
  await sequelize.query(
    `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS withdraw_locked_until TIMESTAMPTZ`,
    { transaction }
  );

  /**
   * Partial, because the overwhelming majority of rows are NULL and only the
   * locked ones are ever looked up as a set (a staff view of "who is frozen").
   * The per-withdrawal read is by primary key and needs no index at all.
   */
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_users_withdraw_locked_until
       ON users (withdraw_locked_until)
       WHERE withdraw_locked_until IS NOT NULL`,
    { transaction }
  );

  logger?.info('Created users.withdraw_locked_until');
}

async function down({ sequelize, transaction, logger }) {
  /**
   * Dropping this UNFREEZES every account currently inside its window, which
   * is the opposite direction from migration 039's `down` but the same class
   * of surprise: a schema change that silently changes who can move money.
   */
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this lifts the withdrawal freeze on every account currently ' +
        'inside its 24-hour window after a password change. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP INDEX IF EXISTS idx_users_withdraw_locked_until', { transaction });
  await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS withdraw_locked_until', { transaction });
  logger?.warn('Dropped users.withdraw_locked_until');
}

module.exports = { up, down };

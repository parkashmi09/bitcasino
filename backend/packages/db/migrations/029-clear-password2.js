'use strict';

/**
 * Clear `password2` — the cleartext password column.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THIS COLUMN IS
 *
 * `users.password2` and `staff.password2` hold the account's password in
 * cleartext, beside the bcrypt hash. Every write path in the legacy codebase
 * maintained it — registration, the player edit, two staff paths and the lords
 * password reset — six writers in all.
 *
 * It is not a leftover. It is READ, by `Rule.resetClientPassword`:
 *
 *     Rule.getPassword2ById(user_id, (password) => {
 *       console.log('Password lookup result:', password);
 *       ...
 *       Email.passwordReset(email, password, name, (sended) => {
 *
 * "Forgot password" retrieved the existing password and emailed it. That is
 * why earlier batches of this port flagged the column but did not clear it —
 * clearing it without replacing the reset flow first would have broken the
 * only way a locked-out player could get back in.
 *
 * ── THE PREREQUISITE IS NOW IN PLACE ─────────────────────────────────────
 *
 * `AuthService.requestPasswordReset` / `completePasswordReset` issue a
 * single-use token, hashed at rest, that expires in thirty minutes and lets
 * the user choose a new password. Nothing reads `password2` any more.
 *
 * ── WHAT RUNNING THIS COSTS ──────────────────────────────────────────────
 *
 * Nothing operational. No code path reads the column after this port. What it
 * removes is the ability to answer "what was this user's password" — which
 * nobody should be able to answer, and which was previously answerable by
 * anyone with a database read, a backup, or `/pedramx`.
 *
 * The column itself is LEFT IN PLACE, nulled. Dropping it is a second,
 * separate decision: a rollback to the legacy application would then fail on
 * INSERT rather than merely losing a feature, and this migration should be
 * safe to run while legacy is still serving.
 */

async function up({ sequelize, transaction, logger }) {
  for (const table of ['users', 'staff']) {
    /**
     * Count first, so the log line says what was actually there. An operator
     * running this wants to know the size of what was exposed, and after the
     * UPDATE that number is unrecoverable.
     */
    const [[before]] = await sequelize.query(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE password2 IS NOT NULL`,
      { transaction }
    );

    if (!before.n) {
      logger?.info(`${table}.password2 was already empty`);
      continue;
    }

    await sequelize.query(`UPDATE ${table} SET password2 = NULL WHERE password2 IS NOT NULL`, {
      transaction,
    });

    logger?.warn(
      { table, cleared: before.n },
      `Cleared ${before.n} cleartext password(s) from ${table}.password2`
    );
  }

  /**
   * A comment on the column, so anyone reading the schema later — in psql, in
   * a diagram, in a migration of their own — finds out what it was before they
   * find a use for it.
   */
  for (const table of ['users', 'staff']) {
    await sequelize.query(
      `COMMENT ON COLUMN ${table}.password2 IS ` +
        `'DEAD. Held the cleartext password beside the hash; read by the legacy ` +
        `password-reset flow, which emailed it. Cleared by migration 029. ` +
        `Do not write to this column.'`,
      { transaction }
    );
  }
}

async function down({ sequelize, transaction, logger }) {
  /**
   * There is no down.
   *
   * The data this removed was the cleartext passwords themselves. They cannot
   * be restored from the hashes, and restoring them would be the wrong thing
   * to want. The column is still there and still nullable, so an application
   * that wrote to it would function — it would simply be starting a fresh
   * collection of cleartext passwords, which is what this exists to end.
   */
  logger?.info('029-clear-password2 has no down migration — cleartext passwords are not recoverable, by design');
}

module.exports = { up, down };

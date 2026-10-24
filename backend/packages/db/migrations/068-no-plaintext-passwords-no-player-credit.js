'use strict';

/**
 * Two clean-ups the operator signed off on together.
 *
 * 1. `password2` EMPTY AGAIN — NULL, not ''.
 *
 *    029 nulled the cleartext-password column in `users` and `staff`, and no
 *    application path has read or written it since. Two test-account scripts
 *    (`scripts/seed-test-logins.js`, `scripts/make-dummy-accounts.js`) kept
 *    writing `password2 = ''` on every run, so rows such as the `smartbetadmin`
 *    staff account showed a non-NULL `password2`. The value was an empty
 *    string, not a password — but "non-NULL means something is in there" is the
 *    check anyone auditing the column will run, and it must come back 0. The
 *    scripts now write NULL; this nulls whatever they already wrote.
 *
 *    The column is KEPT (nullable, unused) for the same reason 029 kept it: a
 *    rollback to older code that still names it would fail on INSERT rather
 *    than merely losing a feature. Nothing in the app reads or writes it.
 *
 * 2. NO CREDIT PLAY FOR PLAYERS.
 *
 *    `credits.credit_limit` (062) let an operator store a "credit line" on a
 *    player. It was never enforced on a player's own debits (every bet and
 *    withdrawal guards at `>= 0`), but the product decision is now explicit:
 *    players never play on credit. `POST /admin/accounts/credit-limit` refuses
 *    `accountType: 'user'` (ACCOUNTS_PLAYER_CREDIT_NOT_SUPPORTED) and the panel
 *    no longer offers it, so every stored player value goes to 0 here.
 *    Staff credit lines (`staff_balances.credit_limit`, the agent's float) are
 *    untouched.
 *
 * Idempotent: every write is conditional. No down — cleartext passwords and
 * player credit lines are not things to restore.
 */

async function up({ sequelize, transaction, logger }) {
  for (const table of ['users', 'staff']) {
    const [, meta] = await sequelize.query(
      `UPDATE ${table} SET password2 = NULL WHERE password2 IS NOT NULL`,
      { transaction }
    );
    const cleared = meta?.rowCount ?? 0;
    if (cleared) logger?.warn({ table, cleared }, `Nulled ${cleared} ${table}.password2 value(s)`);

    await sequelize.query(
      `COMMENT ON COLUMN ${table}.password2 IS ` +
        `'DEAD. Held the cleartext password beside the hash. Nulled by migrations ` +
        `029 and 068; nothing reads or writes it. Must stay NULL.'`,
      { transaction }
    );
  }

  const [, credit] = await sequelize.query(
    // `uid IS NOT NULL`: player rows only. Since 099 staff/owner wallets live in
    // `credits` too (uid NULL) and their credit_limit is the agent's real credit line.
    `UPDATE credits SET credit_limit = 0 WHERE uid IS NOT NULL AND (credit_limit IS NULL OR credit_limit <> 0)`,
    { transaction }
  );
  const zeroed = credit?.rowCount ?? 0;
  if (zeroed) logger?.warn({ zeroed }, `Zeroed ${zeroed} player credit limit(s)`);

  await sequelize.query(
    `COMMENT ON COLUMN credits.credit_limit IS ` +
      `'UNUSED. Players never play on credit (migration 068); always 0. ` +
      `Agent credit lines live in staff_balances.credit_limit.'`,
    { transaction }
  );
}

async function down({ logger }) {
  logger?.info('068 has no down — cleartext passwords and player credit lines are not restored, by design');
}

module.exports = { up, down };

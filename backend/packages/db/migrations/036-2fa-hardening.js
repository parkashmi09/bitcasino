'use strict';

/**
 * Second-factor hardening: encrypted secrets, replay protection, and staff 2FA.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THREE DEFECTS, ONE MIGRATION, BECAUSE THEY SHARE A SHAPE
 *
 * 1. THE SECRET WAS STORED IN THE CLEAR.
 *
 *    `users.two_fa` and `user_2fa.secret_key` both held the base32 shared
 *    secret as plain text. A copy of the database — a dump, a backup under
 *    `db_backups/`, a read replica — was enough to generate valid codes for
 *    every enrolled player, forever, without touching the application.
 *    Passwords and refresh tokens here are both hashed; this was the one
 *    credential kept in a directly usable form.
 *
 *    A secret cannot be hashed: producing the code the phone shows requires
 *    the original. So it is encrypted instead — AES-256-GCM, see
 *    `packages/auth/src/secretBox.js`. Encrypted values are longer than the
 *    32-character base32 they replace, which is why the columns widen.
 *
 * 2. A CODE COULD BE REPLAYED FOR ITS WHOLE WINDOW.
 *
 *    Verification asked "is this code valid now", and with `window: 1` a code
 *    is valid for three 30-second steps. Nothing recorded that one had been
 *    spent, so the same six digits worked repeatedly for up to 90 seconds —
 *    which makes it a short-lived second password rather than a one-time one.
 *    Anyone who observed a code had a minute and a half to use it.
 *
 *    `last_used_step` stores the 30-second counter of the last accepted code.
 *    A code at or below it is refused. The step is stored rather than the code
 *    so the column is useless to anyone who reads it.
 *
 * 3. STAFF HAD NO SECOND FACTOR AT ALL.
 *
 *    Players could enable TOTP and the login enforced it. Staff — whose tokens
 *    carry `wallet:credit`, `withdrawals:approve` and `users:lock` over other
 *    people's money — had none. The credential with the most authority on the
 *    platform was protected by a password alone.
 *
 *    `staff.two_fa_*` mirrors the player columns rather than reusing
 *    `user_2fa`: that table is keyed on `uid` in the users domain, and pointing
 *    it at two different identity tables is how a lookup eventually returns the
 *    wrong person's secret.
 *
 * ── NOTHING IS BACKFILLED, AND NOTHING BREAKS ────────────────────────────
 *
 * Existing plaintext secrets stay exactly as they are. `SecretBox.open()`
 * recognises a bare base32 value and returns it unchanged, so every enrolled
 * player keeps working through the migration; the value is re-sealed the next
 * time that row is written. Converting them here would need the encryption key
 * inside the migration runner, and a half-finished conversion would lock
 * people out of their own accounts.
 *
 * Staff 2FA arrives OFF for everyone. Turning it on for accounts that have not
 * enrolled would lock every operator out of the panel at deploy.
 * ═════════════════════════════════════════════════════════════════════════
 */

const { QueryTypes } = require('sequelize');

/** Columns already present are skipped, so this is safe to re-run. */
async function columnExists(sequelize, transaction, table, column) {
  const [row] = await sequelize.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = :table AND column_name = :column`,
    { transaction, type: QueryTypes.SELECT, replacements: { table, column } }
  );
  return Boolean(row);
}

async function tableExists(sequelize, transaction, table) {
  const [row] = await sequelize.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = :table`,
    { transaction, type: QueryTypes.SELECT, replacements: { table } }
  );
  return Boolean(row);
}

async function addColumn(sequelize, transaction, logger, table, column, definition) {
  if (!(await tableExists(sequelize, transaction, table))) {
    logger?.warn(`Table ${table} does not exist — skipping ${table}.${column}`);
    return;
  }
  if (await columnExists(sequelize, transaction, table, column)) {
    logger?.info(`${table}.${column} already present — nothing to do`);
    return;
  }
  await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, { transaction });
  logger?.info(`Added ${table}.${column}`);
}

async function up({ sequelize, transaction, logger }) {
  // ── 1. Room for a sealed secret ─────────────────────────────────────
  /**
   * `v1.<iv>.<tag>.<ciphertext>` in base64url runs to roughly 110 characters
   * for a 32-character secret. TEXT rather than a sized VARCHAR so a future
   * format version cannot silently truncate — a truncated ciphertext fails its
   * authentication tag and reads as "wrong code", which is the hardest possible
   * way to diagnose a schema problem.
   */
  for (const [table, column] of [
    ['users', 'two_fa'],
    ['user_2fa', 'secret_key'],
  ]) {
    if (!(await tableExists(sequelize, transaction, table))) continue;
    if (!(await columnExists(sequelize, transaction, table, column))) continue;
    await sequelize.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TEXT`, { transaction });
    logger?.info(`Widened ${table}.${column} to TEXT for encrypted secrets`);
  }

  // ── 2. Replay protection for players ────────────────────────────────
  await addColumn(sequelize, transaction, logger, 'user_2fa', 'last_used_step', 'BIGINT NULL');

  // ── 3. Staff second factor ──────────────────────────────────────────
  await addColumn(sequelize, transaction, logger, 'staff', 'two_fa_secret', 'TEXT NULL');
  await addColumn(
    sequelize,
    transaction,
    logger,
    'staff',
    'two_fa_enabled',
    // NOT NULL DEFAULT false: a third state here is a question nothing asks,
    // and a null would read as "off" in one branch and "unknown" in another.
    'BOOLEAN NOT NULL DEFAULT false'
  );
  await addColumn(sequelize, transaction, logger, 'staff', 'two_fa_last_step', 'BIGINT NULL');
  await addColumn(sequelize, transaction, logger, 'staff', 'two_fa_enrolled_at', 'TIMESTAMPTZ NULL');

  /**
   * Which accounts have a second factor is an operational question asked on
   * every staff listing screen, and it is the query a security review runs
   * first. Partial index because the interesting set is the enabled one.
   */
  if (await tableExists(sequelize, transaction, 'staff')) {
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS staff_two_fa_enabled_idx
         ON staff (two_fa_enabled) WHERE two_fa_enabled = true`,
      { transaction }
    );
  }

  logger?.info(
    'Second-factor hardening applied: secrets can now be stored encrypted, codes cannot be replayed, ' +
      'and staff accounts can enrol. Existing plaintext secrets keep working and are re-sealed on next write.'
  );
}

/**
 * No `down()`.
 *
 * Reversing this drops the columns that hold staff second factors and the
 * replay counters — it would not restore a previous state, it would delete
 * enrolments and silently reopen the replay window. The widened TEXT columns
 * are also not reversible without truncating any secret already encrypted.
 * A migration should not be a way to reintroduce the finding it closed.
 */
module.exports = { up };

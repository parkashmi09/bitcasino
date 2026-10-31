'use strict';

/**
 * `user_otps` — the one-time codes behind registration, login and 2FA reset.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. THE FOREIGN KEY MADE REGISTRATION CODES IMPOSSIBLE
 *
 * The table was created at runtime, from a constructor, with:
 *
 *     CONSTRAINT fk_email FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
 *
 * A registration OTP is by definition for an address with no account yet, so
 * every one of them failed:
 *
 *     insert or update on table "user_otps" violates foreign key constraint "fk_email"
 *
 * and `/email/otp/send` with `purpose: "register"` — the only purpose the route
 * advertises first — has never once worked. The constraint encodes the opposite
 * of what the table is for, so it goes.
 *
 * `ON DELETE CASCADE` had a second effect worth noting: changing a player's
 * email address deleted their outstanding codes, including the one they were
 * mid-way through using.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 2. NOTHING STOPPED TWO LIVE CODES FOR THE SAME PURPOSE
 *
 * `generateAndSaveOTP` deleted the previous unverified code and inserted a new
 * one — two statements, no transaction, no constraint. Two simultaneous
 * requests both deleted, both inserted, and the account ended up with two valid
 * codes; `verifyOTP` then took whichever `ORDER BY created_at DESC LIMIT 1`
 * happened to return, so one of the two was accepted and the other was a live
 * credential nobody was tracking.
 *
 * A partial unique index makes "one outstanding code per address per purpose"
 * the database's rule.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 3. THE TABLE WAS CREATED FROM A CONSTRUCTOR
 *
 *     class OTPService {
 *       constructor() { this.createOTPTable(); }   // fire-and-forget DDL
 *
 * An un-awaited `CREATE TABLE IF NOT EXISTS` at module load, with the error
 * swallowed by a `catch` that only logged. Whether the table existed depended
 * on whether that promise resolved before the first request arrived. Schema
 * belongs in a migration; this is that migration.
 */

async function up({ sequelize, transaction, logger }) {
  // ── 1. The foreign key that made registration codes impossible ───────
  const [[{ exists: hasFk }]] = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'user_otps' AND constraint_name = 'fk_email'
     ) AS exists`,
    { transaction }
  );

  if (hasFk) {
    await sequelize.query('ALTER TABLE user_otps DROP CONSTRAINT fk_email', { transaction });
    logger?.warn(
      'Dropped user_otps.fk_email — it referenced users(email), so every registration OTP failed on insert'
    );
  }

  // ── 2. One outstanding code per address per purpose ──────────────────
  /**
   * Resolved before the constraint goes on: keep the NEWEST unverified code of
   * each group, because that is the one the player was last sent, and delete
   * the rest. They are codes, not records of anything that happened, so there
   * is nothing to preserve.
   */
  const [removed] = await sequelize.query(
    `DELETE FROM user_otps a
      WHERE a.is_verified = FALSE
        AND a.id <> (
              SELECT b.id FROM user_otps b
               WHERE b.email = a.email AND b.purpose = a.purpose AND b.is_verified = FALSE
               ORDER BY b.created_at DESC, b.id DESC
               LIMIT 1
            )
      RETURNING a.id`,
    { transaction }
  );

  if (removed?.length) {
    logger?.warn(
      { count: removed.length },
      'Removed duplicate outstanding OTPs — the legacy issue path was a DELETE followed by an INSERT with no constraint between them'
    );
  }

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_otps_outstanding
       ON user_otps (email, purpose) WHERE is_verified = FALSE`,
    { transaction }
  );

  // ── 3. Columns the application needs and the runtime DDL never had ───
  /**
   * `expires_at` existed but was written from `CURRENT_TIMESTAMP + INTERVAL`
   * and then IGNORED at verification time, which recomputed the age from
   * `created_at` instead. Two sources of truth for one deadline; the column is
   * the one that stays, and it is indexed so expired codes can be swept.
   */
  await sequelize.query(
    `ALTER TABLE user_otps
       ALTER COLUMN expires_at SET NOT NULL,
       ALTER COLUMN attempts SET DEFAULT 0,
       ALTER COLUMN attempts SET NOT NULL,
       ALTER COLUMN is_verified SET DEFAULT FALSE,
       ALTER COLUMN is_verified SET NOT NULL`,
    { transaction }
  ).catch(async () => {
    // A pre-existing row with a null `expires_at` blocks the NOT NULL. Fill
    // them from `created_at` first — the legacy TTL was two minutes — rather
    // than failing the migration on data the old code allowed.
    await sequelize.query(
      `UPDATE user_otps SET expires_at = created_at + INTERVAL '2 minutes' WHERE expires_at IS NULL`,
      { transaction }
    );
    await sequelize.query('ALTER TABLE user_otps ALTER COLUMN expires_at SET NOT NULL', { transaction });
  });

  /** When a verified code was spent, so proof of verification can expire. */
  await sequelize.query(
    'ALTER TABLE user_otps ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ',
    { transaction }
  );

  /** Where the request came from, so a flood has a source in the audit trail. */
  await sequelize.query('ALTER TABLE user_otps ADD COLUMN IF NOT EXISTS request_ip VARCHAR(64)', { transaction });

  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_user_otps_expiry ON user_otps (expires_at)',
    { transaction }
  );

  logger?.info('user_otps integrity in place — registration codes can now be issued at all');
}

async function down({ sequelize, transaction, logger }) {
  for (const sql of [
    'DROP INDEX IF EXISTS uq_user_otps_outstanding',
    'DROP INDEX IF EXISTS idx_user_otps_expiry',
    'ALTER TABLE user_otps DROP COLUMN IF EXISTS verified_at',
    'ALTER TABLE user_otps DROP COLUMN IF EXISTS request_ip',
  ]) {
    await sequelize.query(sql, { transaction });
  }

  // `fk_email` is NOT restored. It is the defect this migration exists to
  // remove, and putting it back would break registration again.
  logger?.warn('Reverted user_otps integrity — two outstanding codes per purpose are possible again');
}

module.exports = { up, down };

'use strict';

/**
 * Integrity for the spin wheel and the redeem codes it issues.
 *
 * ── 1. `redeembonus` has no primary key and no unique column ─────────────
 *
 * The table stores redemption codes. A code is a bearer instrument: whoever
 * holds it gets a bonus percentage applied to their next deposit. Two rows
 * sharing a code is therefore not a cosmetic problem — it makes "which bonus
 * does this code grant" unanswerable, and the legacy code generated codes with
 * a SELECT-then-INSERT that has a window between the two:
 *
 *     while (!isUnique) {
 *       code = sha256(...).slice(0, 8)
 *       const { rowCount } = await pg.query('SELECT 1 FROM redeembonus WHERE code = $1')
 *       if (rowCount === 0) isUnique = true       // ← another request can
 *     }                                           //   insert this code here
 *     INSERT INTO redeembonus (code, ...)
 *
 * Eight hex characters is 4.3 billion values, so a natural collision is
 * unlikely — but the loop is what makes the code unguessable, and without a
 * constraint nothing stops a duplicate from a race or a bad backfill.
 *
 * A primary key is added too. A table with no key cannot be updated by row from
 * an ORM, which is why the generated model carries a "reads and inserts only"
 * note.
 *
 * ── 2. One spin per player per cooldown ──────────────────────────────────
 *
 * The claim path read the last claim, checked the cooldown, and then inserted.
 * Two simultaneous requests both read the same last claim and both passed. With
 * `user_id` taken from the request body on an unauthenticated route, that was a
 * one-line script away from unlimited spins.
 *
 * The application now serialises on the player's row, but a partial unique
 * index on the redeem code closes the other half: two spins cannot both issue
 * an active code.
 */

async function up({ sequelize, transaction, logger }) {
  // ── redeembonus: a key, and uniqueness on the code ──────────────────
  const [[{ exists: hasPk }]] = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'redeembonus' AND constraint_type = 'PRIMARY KEY'
     ) AS exists`,
    { transaction }
  );

  if (!hasPk) {
    await sequelize.query('ALTER TABLE redeembonus ADD COLUMN IF NOT EXISTS id BIGSERIAL', { transaction });
    await sequelize.query('ALTER TABLE redeembonus ADD PRIMARY KEY (id)', { transaction });
    logger?.info('Added a primary key to redeembonus');
  }

  /**
   * Duplicate codes are resolved before the constraint goes on, because the
   * migration must not fail on data the legacy race may already have created.
   *
   * The OLDEST row keeps the code — it is the one whose holder was told it
   * first. The others are marked `superseded` rather than deleted: a player
   * holding one deserves an explanation, and a deleted row cannot give one.
   */
  const [duplicates] = await sequelize.query(
    `UPDATE redeembonus r
        SET status = 'superseded'
      WHERE r.ctid NOT IN (
              SELECT MIN(x.ctid) FROM redeembonus x WHERE x.code = r.code
            )
        AND r.code IS NOT NULL
      RETURNING r.code`,
    { transaction }
  );

  if (duplicates?.length) {
    logger?.warn(
      { count: duplicates.length },
      'Found duplicate redeem codes and marked the later ones superseded — the legacy generator had a race'
    );
  }

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_redeembonus_code
       ON redeembonus (code) WHERE code IS NOT NULL`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_redeembonus_user_status
       ON redeembonus (userid, status)`,
    { transaction }
  );

  // ── spin_wheel_claims: find a player's last spin quickly ────────────
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_spin_claims_user_time
       ON spin_wheel_claims (user_id, claimed_at DESC)`,
    { transaction }
  );

  logger?.info('Spin wheel and redeem code integrity in place');
}

async function down({ sequelize, transaction, logger }) {
  // Dropping the indexes is safe; the primary key is left in place because
  // removing it would break every ORM update written against the table since.
  for (const sql of [
    'DROP INDEX IF EXISTS uq_redeembonus_code',
    'DROP INDEX IF EXISTS idx_redeembonus_user_status',
    'DROP INDEX IF EXISTS idx_spin_claims_user_time',
  ]) {
    await sequelize.query(sql, { transaction });
  }
  logger?.warn('Dropped the redeem-code uniqueness constraint — duplicate codes are possible again');
}

module.exports = { up, down };

'use strict';

/**
 * Sabka balance ab `credits` table me — owner, staff (admin se agent tak) aur player.
 *
 * Pehle:
 *   player  → credits.inr          (uid = users.id)
 *   staff   → staff_balances.inr   (owner bhi yahi, par owner ka balance kabhi kat-ta nahi tha)
 *
 * Ab:
 *   player  → credits row, user_type 'USER',  uid = users.id,  staff_id NULL
 *   staff   → credits row, user_type 'STAFF', staff_id = staff.id, uid NULL
 *   owner   → credits row, user_type 'OWNER', staff_id = owner ka staff.id (level 1), uid NULL
 *
 * Nayi columns (sirf kaam wali):
 *   user_type       kiska wallet hai — 'USER' | 'STAFF' | 'OWNER'
 *   staff_id        staff/owner ka id (player row me NULL)
 *   exposure_limit  staff ki exposure limit (staff_balances se aayi)
 *
 * `credit_limit` (062), `credit` aur `all_point` (095) pehle se hain.
 * `username` / `parent_staff_id` jaan-boojh ke NAHI rakhe — wo `users` / `staff`
 * me hain, yahan copy karte to rename pe purane reh jaate.
 *
 * staff_balances ka data yahan copy hota hai. Table abhi delete nahi ki
 * (code ab usse nahi padhta), taaki zarurat pade to purana data dekh sakein.
 *
 * Idempotent: dobara chalane pe kuch double nahi hota.
 */

async function up({ sequelize, transaction, logger }) {
  const run = (sql) => sequelize.query(sql, { transaction });

  // 1. Nayi columns. Staff row me uid nahi hota, isliye uid NULL ho sakta hai.
  await run(`ALTER TABLE credits ADD COLUMN IF NOT EXISTS user_type VARCHAR(10) NOT NULL DEFAULT 'USER'`);
  await run('ALTER TABLE credits ADD COLUMN IF NOT EXISTS staff_id BIGINT');
  await run('ALTER TABLE credits ADD COLUMN IF NOT EXISTS exposure_limit NUMERIC NOT NULL DEFAULT 0');
  await run('ALTER TABLE credits ALTER COLUMN uid DROP NOT NULL');

  // Ek staff ka ek hi wallet.
  await run('CREATE UNIQUE INDEX IF NOT EXISTS credits_staff_id_key ON credits (staff_id) WHERE staff_id IS NOT NULL');

  // Har row ya to player ki hai (uid) ya staff/owner ki (staff_id) — dono ya koi nahi, galat.
  await run(`
    DO $$ BEGIN
      ALTER TABLE credits ADD CONSTRAINT credits_owner_check CHECK (
        (user_type = 'USER' AND uid IS NOT NULL AND staff_id IS NULL)
        OR (user_type IN ('STAFF', 'OWNER') AND staff_id IS NOT NULL AND uid IS NULL)
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  // 2. Har staff ki credits row, staff_balances ka balance copy karke.
  //    Level 1 (Super Admin) = OWNER.
  const [staffRows] = await run(`
    INSERT INTO credits (user_type, staff_id, uid, inr, credit_limit, exposure_limit)
    SELECT
      CASE WHEN r.level = 1 THEN 'OWNER' ELSE 'STAFF' END,
      s.id,
      NULL,
      COALESCE(b.inr, 0),
      COALESCE(b.credit_limit, 0),
      COALESCE(b.exposure_limit, 0)
    FROM staff s
    LEFT JOIN roles r ON r.id = s.role_id
    LEFT JOIN staff_balances b ON b.staff_id = s.id
    WHERE NOT EXISTS (SELECT 1 FROM credits c WHERE c.staff_id = s.id)
    RETURNING staff_id
  `);
  logger?.info(`credits: ${staffRows.length} staff/owner wallet(s) created from staff_balances`);

  // credit_limit ab do kaam karta hai — comment bhi sahi karo (068 ne "UNUSED" likha tha).
  await run(
    `COMMENT ON COLUMN credits.credit_limit IS ` +
      `'Player rows: always 0, players never play on credit (068). ` +
      `Staff/owner rows (staff_id set): the agent credit line (099).'`
  );

  // 3. Jis player ki credits row nahi thi, uski 0 wali row.
  const [userRows] = await run(`
    INSERT INTO credits (user_type, uid, inr)
    SELECT 'USER', u.id, 0
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM credits c WHERE c.uid = u.id)
    RETURNING uid
  `);
  logger?.info(`credits: ${userRows.length} missing player wallet(s) created`);
}

async function down({ sequelize, transaction, logger }) {
  const run = (sql) => sequelize.query(sql, { transaction });

  // Staff ka balance wapas staff_balances me, phir staff rows hatao.
  await run(`
    UPDATE staff_balances b
    SET inr = c.inr, credit_limit = c.credit_limit, exposure_limit = c.exposure_limit
    FROM credits c
    WHERE c.staff_id = b.staff_id
  `);
  await run('DELETE FROM credits WHERE staff_id IS NOT NULL');

  await run('ALTER TABLE credits DROP CONSTRAINT IF EXISTS credits_owner_check');
  await run('DROP INDEX IF EXISTS credits_staff_id_key');
  await run('ALTER TABLE credits ALTER COLUMN uid SET NOT NULL');
  await run('ALTER TABLE credits DROP COLUMN IF EXISTS exposure_limit');
  await run('ALTER TABLE credits DROP COLUMN IF EXISTS staff_id');
  await run('ALTER TABLE credits DROP COLUMN IF EXISTS user_type');
  logger?.warn('Staff/owner wallets moved back to staff_balances');
}

module.exports = { up, down };

'use strict';

/**
 * `bonusgame` and `bonushistory` — two tables no row could be addressed in.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NEITHER TABLE HAS A PRIMARY KEY
 *
 * Both ship with no primary key and no unique column, so the generated models
 * carry this header:
 *
 *     NOTE: no primary key and no unique column. This model supports reads and
 *     inserts; updates/deletes must go through an explicit WHERE clause.
 *
 * Which is exactly what legacy did, and it is why the six CRUD endpoints over
 * these tables behave the way they do:
 *
 *     UPDATE bonushistory SET event = $1, amount = $2 WHERE userid = $3
 *     DELETE FROM bonushistory WHERE userid = $1
 *
 * `bonushistory` is an append-only log — one row per bonus event. "Update the
 * bonus history" therefore rewrote EVERY row for that player to the same event
 * and the same amount, and "delete" erased the player's entire history. There
 * was no way to express "this one row", because there was no way to name one.
 *
 * ── AND `bonusgame` COULD HOLD ANY NUMBER OF ROWS PER PLAYER ─────────────
 *
 * `createbonusgame` was a bare INSERT with no conflict handling, so calling it
 * twice gave a player two counter rows. `updatebonusgame` then ran
 * `UPDATE ... WHERE userid = $1` — hitting all of them — and returned
 * `rows[0]`, so the response showed one row while several had changed. The
 * player's bonus counters became whichever duplicate a later read happened to
 * order first.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THIS MIGRATION DOES
 *
 *   1. Collapses duplicate `bonusgame` rows, one per player.
 *   2. Gives both tables a primary key.
 *   3. Makes `bonusgame.userid` unique, so the collapse cannot recur.
 *   4. Widens `bonushistory.amount` from INTEGER to NUMERIC.
 *
 * ── ON COLLAPSING DUPLICATES ─────────────────────────────────────────────
 *
 * Every `bonusgame` column is an additive counter — legacy only ever wrote
 * `COALESCE(col, 0) + $n` to them — so the correct merge of N rows for one
 * player is the column-wise SUM. That preserves the total granted, which is the
 * number these counters exist to record. The alternative, keeping the newest
 * row, would silently discard bonuses that were really awarded.
 *
 * The count of players affected is logged. If it is not zero, that number is
 * how many accounts had their bonus counters split across rows, and it is worth
 * reading before the unique index goes on.
 *
 * ── ON `amount` BEING AN INTEGER ─────────────────────────────────────────
 *
 * `bonushistory.amount` is INTEGER. Legacy inserted computed bonus values into
 * it, so Postgres rounded each one to a whole unit on the way in: a 0.40 bonus
 * was logged as 0 and a 0.60 bonus as 1. Same defect as the BIGINT money
 * columns in `transaction_live` / `transaction_slot` (see migration 017).
 *
 * Widening is safe in a way that widening those was not: this table is a
 * display log, not the settlement record, so the existing whole numbers stay
 * exactly what they were and only future rows gain the missing precision. The
 * historical rows remain rounded — that information was destroyed on insert and
 * no migration can recover it.
 */

async function up({ sequelize, transaction, logger }) {
  // ══════════════════════════════════════════════════════════════════════
  //  1. Collapse duplicate bonusgame rows
  // ══════════════════════════════════════════════════════════════════════
  const [duplicates] = await sequelize.query(
    `SELECT userid, COUNT(*) AS n
       FROM bonusgame
      GROUP BY userid
     HAVING COUNT(*) > 1`,
    { transaction }
  );

  if (duplicates.length) {
    logger?.warn(
      {
        players: duplicates.length,
        rows: duplicates.reduce((sum, d) => sum + Number(d.n), 0),
        sample: duplicates.slice(0, 10).map((d) => ({ userid: d.userid, rows: Number(d.n) })),
      },
      'bonusgame holds duplicate rows per player — merging them by summing each counter'
    );

    /**
     * Sum the counters, keep the earliest `createdat`, stamp `updatedat` now.
     *
     * Written as replace-in-place rather than delete-the-losers because there
     * is no key to identify a loser by — that is the whole problem being fixed.
     */
    await sequelize.query(
      `CREATE TEMP TABLE bonusgame_merged ON COMMIT DROP AS
         SELECT userid,
                SUM(COALESCE(luckyspin, 0))            AS luckyspin,
                SUM(COALESCE(dailybonus, 0))           AS dailybonus,
                SUM(COALESCE(weeklybonus, 0))          AS weeklybonus,
                SUM(COALESCE(monthlybonus, 0))         AS monthlybonus,
                SUM(COALESCE(depositbonus, 0))         AS depositbonus,
                SUM(COALESCE(rollcompetitionbonus, 0)) AS rollcompetitionbonus,
                SUM(COALESCE(rakebackbonus, 0))        AS rakebackbonus,
                MIN(createdat)                         AS createdat
           FROM bonusgame
          GROUP BY userid`,
      { transaction }
    );

    await sequelize.query('DELETE FROM bonusgame', { transaction });

    await sequelize.query(
      `INSERT INTO bonusgame (userid, luckyspin, dailybonus, weeklybonus, monthlybonus,
                              depositbonus, rollcompetitionbonus, rakebackbonus,
                              createdat, updatedat)
         SELECT userid, luckyspin, dailybonus, weeklybonus, monthlybonus,
                depositbonus, rollcompetitionbonus, rakebackbonus,
                createdat, CURRENT_TIMESTAMP
           FROM bonusgame_merged`,
      { transaction }
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  2 + 3. Keys
  // ══════════════════════════════════════════════════════════════════════
  await sequelize.query(
    'ALTER TABLE bonusgame ADD COLUMN IF NOT EXISTS id BIGSERIAL',
    { transaction }
  );
  await sequelize.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'bonusgame_pkey'
       ) THEN
         ALTER TABLE bonusgame ADD CONSTRAINT bonusgame_pkey PRIMARY KEY (id);
       END IF;
     END $$`,
    { transaction }
  );

  // One counter row per player. This is what makes `createbonusgame` an upsert
  // instead of an unbounded insert.
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_bonusgame_userid ON bonusgame (userid)',
    { transaction }
  );

  await sequelize.query(
    'ALTER TABLE bonushistory ADD COLUMN IF NOT EXISTS id BIGSERIAL',
    { transaction }
  );
  await sequelize.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'bonushistory_pkey'
       ) THEN
         ALTER TABLE bonushistory ADD CONSTRAINT bonushistory_pkey PRIMARY KEY (id);
       END IF;
     END $$`,
    { transaction }
  );

  // The log is read newest-first per player on every admin screen.
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_bonushistory_user ON bonushistory (userid, createdat DESC)',
    { transaction }
  );

  // ══════════════════════════════════════════════════════════════════════
  //  4. Money precision
  // ══════════════════════════════════════════════════════════════════════
  await sequelize.query(
    'ALTER TABLE bonushistory ALTER COLUMN amount TYPE NUMERIC(30,8)',
    { transaction }
  );

  logger?.info(
    'bonusgame and bonushistory now have primary keys; bonusgame.userid is unique; bonushistory.amount is NUMERIC'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Reverting narrows bonushistory.amount back to INTEGER, which rounds every ' +
        'decimal bonus written since this ran. It also cannot un-merge the collapsed ' +
        'bonusgame rows. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }

  await sequelize.query('ALTER TABLE bonushistory ALTER COLUMN amount TYPE INTEGER', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_bonushistory_user', { transaction });
  await sequelize.query('ALTER TABLE bonushistory DROP CONSTRAINT IF EXISTS bonushistory_pkey', { transaction });
  await sequelize.query('ALTER TABLE bonushistory DROP COLUMN IF EXISTS id', { transaction });

  await sequelize.query('DROP INDEX IF EXISTS uq_bonusgame_userid', { transaction });
  await sequelize.query('ALTER TABLE bonusgame DROP CONSTRAINT IF EXISTS bonusgame_pkey', { transaction });
  await sequelize.query('ALTER TABLE bonusgame DROP COLUMN IF EXISTS id', { transaction });

  logger?.warn('Reverted the bonus counter keys; the merged bonusgame rows stay merged');
}

module.exports = { up, down };

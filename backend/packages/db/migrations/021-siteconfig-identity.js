'use strict';

/**
 * `siteconfig` — the platform's settings row, with no way to name it.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NO PRIMARY KEY, AND EVERY WRITE ASSUMED ONE ROW
 *
 * The table ships with `id integer DEFAULT nextval(...) NOT NULL` and no
 * PRIMARY KEY constraint, so nothing stops two rows sharing an id and nothing
 * stops the table holding fifty of them. Legacy read it as:
 *
 *     SELECT affiliatebonus, comissionpercent, registerbonus FROM siteconfig LIMIT 1
 *
 * `LIMIT 1` with no ORDER BY. Postgres is free to return any row, and which one
 * it picks can change after a VACUUM — so the platform's commission rate was
 * whichever row the planner reached first.
 *
 * And it wrote it as:
 *
 *     UPDATE siteconfig SET affiliatebonus = $1, ... RETURNING ...
 *
 * with NO WHERE CLAUSE. Every row rewritten, then `rows[0]` of an unordered
 * RETURNING reported back as "the" new settings.
 *
 * Neither statement is wrong if the table holds exactly one row. Nothing in the
 * schema said it did.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THIS DOES
 *
 *   1. A primary key on `id`, so a row can be addressed.
 *   2. A single-row constraint — but ONLY if the table currently holds at most
 *      one row.
 *
 * ── ON THE CONDITIONAL CONSTRAINT ────────────────────────────────────────
 *
 * `CREATE UNIQUE INDEX ... ON siteconfig ((true))` permits exactly one row,
 * which is what every reader and writer already assumes. Against a table that
 * already holds several it simply fails, and a migration that fails on real
 * data at deploy time is worse than one that reports the problem.
 *
 * So it is applied when it can be, and skipped with a loud warning when it
 * cannot. If you see that warning, the extra rows are settings somebody wrote
 * that nothing has been reading — decide which one is real before forcing it.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'siteconfig_pkey'
       ) THEN
         ALTER TABLE siteconfig ADD CONSTRAINT siteconfig_pkey PRIMARY KEY (id);
       END IF;
     END $$`,
    { transaction }
  );

  const [[{ count }]] = await sequelize.query('SELECT COUNT(*)::int AS count FROM siteconfig', {
    transaction,
  });

  if (count > 1) {
    logger?.warn(
      { rows: count },
      'siteconfig holds more than one row — skipping the single-row constraint. ' +
        'Every legacy reader used `LIMIT 1` with no ORDER BY, so the settings in ' +
        'force were whichever row Postgres returned first. Reconcile them, then ' +
        're-run this migration.'
    );
  } else {
    await sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_siteconfig_singleton ON siteconfig ((true))',
      { transaction }
    );
  }

  logger?.info({ rows: count }, 'siteconfig now has a primary key');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP INDEX IF EXISTS uq_siteconfig_singleton', { transaction });
  await sequelize.query('ALTER TABLE siteconfig DROP CONSTRAINT IF EXISTS siteconfig_pkey', { transaction });
  logger?.warn('Dropped the siteconfig primary key — rows can no longer be addressed individually');
}

module.exports = { up, down };

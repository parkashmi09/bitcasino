'use strict';

/**
 * `public.fanwins` as the mssports settlement worker writes it.
 *
 * 094 moved the sportsbook in and added `fanwins.user_id`, but left two
 * baseline columns that make the worker's insert fail. The insert sits inside
 * the fancy settlement transaction, so EVERY fancy bet failed to settle and
 * was requeued forever:
 *
 *   runsodds  INTEGER → NUMERIC(10,4)
 *       The worker's `FanWin` model (as in TENEXCH) is DECIMAL(10,4) and writes
 *       the bet's odds as "74.0000", which Postgres refuses for an integer.
 *       Widening keeps every existing value.
 *
 *   userid    NOT NULL → NULL
 *       The legacy owner column. The worker writes `user_id` (094) and never
 *       `userid`, so the NOT NULL rejected every row.
 *
 * Idempotent: each step checks the column first. `down` narrows runsodds back
 * (rounding) and restores NOT NULL on userid only while no row lacks it.
 */

async function column({ sequelize, transaction }, name) {
  const [rows] = await sequelize.query(
    `SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'fanwins' AND column_name = :name`,
    { replacements: { name }, transaction }
  );
  return rows[0] || null;
}

async function up(ctx) {
  const { sequelize, transaction, logger } = ctx;
  if ((await column(ctx, 'runsodds'))?.data_type === 'integer') {
    await sequelize.query('ALTER TABLE public.fanwins ALTER COLUMN runsodds TYPE NUMERIC(10,4)', { transaction });
    logger?.info('fanwins.runsodds is NUMERIC(10,4)');
  }
  if ((await column(ctx, 'userid'))?.is_nullable === 'NO') {
    await sequelize.query('ALTER TABLE public.fanwins ALTER COLUMN userid DROP NOT NULL', { transaction });
    logger?.info('fanwins.userid is nullable');
  }
}

async function down(ctx) {
  const { sequelize, transaction, logger } = ctx;
  if ((await column(ctx, 'runsodds'))?.data_type === 'numeric') {
    await sequelize.query('ALTER TABLE public.fanwins ALTER COLUMN runsodds TYPE INTEGER USING round(runsodds)::integer', { transaction });
    logger?.warn('fanwins.runsodds narrowed back to INTEGER (rounded)');
  }
  const [[{ n }]] = await sequelize.query('SELECT count(*)::int AS n FROM public.fanwins WHERE userid IS NULL', { transaction });
  if (n === 0) await sequelize.query('ALTER TABLE public.fanwins ALTER COLUMN userid SET NOT NULL', { transaction });
  else logger?.warn(`fanwins.userid left nullable: ${n} row(s) have no userid`);
}

module.exports = { up, down };

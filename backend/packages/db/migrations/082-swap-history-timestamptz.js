'use strict';

/**
 * `swap_history.created_at` → `timestamp with time zone`.
 *
 * The legacy column is `timestamp WITHOUT time zone`, but every row is written
 * by Sequelize (`SwapHistory.create`, the only writer), which sends the instant
 * as UTC (`… +00:00`); Postgres drops the offset and stores the UTC wall time.
 * On the way back, node-postgres parses a zone-less timestamp in the PROCESS
 * time zone, so on a machine running in IST every swap read back 5h30m early
 * (a swap made at 21:09Z showed as 15:39Z in /user/swap/history and the
 * Transactions dialog). Converting with `AT TIME ZONE 'UTC'` keeps each stored
 * instant and makes the read independent of the server's TZ.
 *
 * Idempotent: only converts while the column is still zone-less.
 */
async function up({ sequelize, transaction, logger }) {
  const [rows] = await sequelize.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'swap_history' AND column_name = 'created_at'`,
    { transaction }
  );
  if (rows[0]?.data_type !== 'timestamp without time zone') {
    logger?.info('swap_history.created_at already has a time zone (or no table); nothing to do');
    return;
  }
  await sequelize.query(
    `ALTER TABLE swap_history
       ALTER COLUMN created_at TYPE timestamp with time zone USING created_at AT TIME ZONE 'UTC'`,
    { transaction }
  );
  logger?.info('swap_history.created_at is timestamptz (stored values read as UTC)');
}

async function down({ sequelize, transaction }) {
  const [rows] = await sequelize.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'swap_history' AND column_name = 'created_at'`,
    { transaction }
  );
  if (rows[0]?.data_type !== 'timestamp with time zone') return;
  await sequelize.query(
    `ALTER TABLE swap_history
       ALTER COLUMN created_at TYPE timestamp without time zone USING created_at AT TIME ZONE 'UTC'`,
    { transaction }
  );
}

module.exports = { up, down };

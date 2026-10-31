'use strict';

const { QueryTypes } = require('@ibitplay/db');

/**
 * Demo accounts (migration 161, user 2026-10-27): once its 30 minutes are up and no sports bet of
 * its is still open, a demo account is deleted with everything it made. Runs in the user-worker.
 *
 * Its rows are found by the user columns the tables use (`user_id`, `uid`, `userid`, and
 * `source_user_id` — its `mssports.point_ledger` rows, migration 162) in the
 * `public` and `mssports` schemas — for ids that ARE demo accounts only, so a real player's row
 * can never match. Tables other tables point at (`mssports.users`, `credits`, …) go last, so no
 * foreign key stops the delete. All of it in one transaction: a failure leaves the account whole
 * for the next run.
 */
const USER_COLUMNS = ['user_id', 'uid', 'userid', 'source_user_id'];
const NUMERIC = new Set(['bigint', 'integer', 'smallint', 'numeric']);

async function purgeDemoAccounts({ db, logger }, { limit = 200 } = {}) {
  const { sequelize } = db;
  const select = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

  const ids = (
    await select(
      `SELECT u.id::text AS id FROM users u
        WHERE u.is_demo AND u.demo_expires_at < NOW()
          AND NOT EXISTS (SELECT 1 FROM mssports."SportsBet" b
                           WHERE b.user_id = u.id AND COALESCE(b.result_status, 'pending') = 'pending')
        ORDER BY u.demo_expires_at
        LIMIT :limit`,
      { limit }
    )
  ).map((r) => r.id);
  if (!ids.length) return { purged: 0 };

  const columns = await select(
    `SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS c, c.data_type AS d,
            EXISTS (SELECT 1 FROM pg_constraint f
                     WHERE f.contype = 'f' AND f.confrelid = format('%I.%I', c.table_schema, c.table_name)::regclass) AS parent
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema IN ('public', 'mssports') AND lower(c.column_name) IN (:cols)
        AND NOT (c.table_schema = 'public' AND c.table_name = 'users')`,
    { cols: USER_COLUMNS }
  );
  columns.sort((a, b) => Number(a.parent) - Number(b.parent));

  await sequelize.transaction(async (transaction) => {
    for (const { s, t, c, d } of columns) {
      const cast = NUMERIC.has(d) ? 'bigint' : 'text';
      await sequelize.query(`DELETE FROM "${s}"."${t}" WHERE "${c}" = ANY(ARRAY[:ids]::${cast}[])`, { replacements: { ids }, transaction });
    }
    await sequelize.query('DELETE FROM users WHERE is_demo AND id = ANY(ARRAY[:ids]::bigint[])', { replacements: { ids }, transaction });
  });

  logger?.info({ purged: ids.length }, 'Demo accounts deleted');
  return { purged: ids.length };
}

module.exports = { purgeDemoAccounts };

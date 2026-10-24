'use strict';

/**
 * Every `mssports` table as a read-through view in `public` too (user, 2026-10-18: "sari table
 * bahar chaiye"), extending 127. A view keeps the table's name, or `ms_<name>` when `public`
 * already has a table by that name (users, staff, transactions, SportsBet …). `credits_ledger` gets
 * none: `public.credits_ledger` stays the one common credit ledger in that list (user), so 127's
 * `sports_credits_ledger` goes too.
 * shortcut: views are made from the tables that exist now; re-run (down + up) after adding a table or column.
 */
async function viewNames(q) {
  const [rows] = await q(`
    SELECT m.table_name AS t,
           CASE WHEN p.table_name IS NULL THEN m.table_name ELSE 'ms_' || m.table_name END AS v
      FROM information_schema.tables m
      LEFT JOIN information_schema.tables p
        ON p.table_schema = 'public' AND p.table_name = m.table_name AND p.table_type = 'BASE TABLE'
     WHERE m.table_schema = 'mssports' AND m.table_type = 'BASE TABLE' AND m.table_name <> 'credits_ledger'`);
  return rows;
}

async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('DROP VIEW IF EXISTS public.sports_credits_ledger');
  for (const { t, v } of await viewNames(q)) {
    await q(`CREATE OR REPLACE VIEW public."${v}" AS SELECT * FROM mssports."${t}"`);
  }
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  for (const { v } of await viewNames(q)) {
    if (!['point_ledger', 'point_ledger_direct', 'debit_ledger'].includes(v)) await q(`DROP VIEW IF EXISTS public."${v}"`);
  }
  await q('CREATE OR REPLACE VIEW public.sports_credits_ledger AS SELECT * FROM mssports.credits_ledger');
}

module.exports = { up, down };

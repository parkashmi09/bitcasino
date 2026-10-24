'use strict';

/**
 * Legacy `timestamp WITHOUT time zone` columns → `timestamp with time zone`.
 *
 * The same bug 082 fixed for `swap_history`, on every other legacy table whose
 * writer is provably this codebase. Each of these columns is written only
 * through the shared Sequelize instance, either as a JS `Date` (Sequelize
 * serialises it as `… +00:00`, Postgres drops the offset and keeps the UTC wall
 * time) or as `now()` / `CURRENT_TIMESTAMP` (a column default or raw SQL). The
 * database's own zone is Asia/Kolkata, but Sequelize opens every connection
 * with `SET TIME ZONE INTERVAL '+00:00'`, so `now()` cast to a zone-less
 * timestamp is the UTC wall time as well. The stored values are UTC wall
 * clock, so they convert with `AT TIME ZONE 'UTC'` and keep their instant.
 *
 * Checked on the dev data (cfz_casino_sportsbook) against timestamptz siblings
 * written in the same request: `vault_pro."createdAt"` = `"startTime"`,
 * `team."createdAt"` = `users.created`, `user_login_history.created_at` =
 * `auth_sessions.created_at` (median 0 min; 330 min if they were IST), and the
 * seeder rows (gisgamesnew, gis_providers_new, exchangerate,
 * currency_payment_details) at 11:30 UTC beside js_games / site_features rows
 * written at 11:30 UTC in the same run.
 *
 * Why it matters: node-pg parses a zone-less timestamp in the PROCESS zone, so
 * on a server running in IST every one of these read back 5h30m early. The
 * readers that compensated for that (`AT TIME ZONE 'UTC'` on the column, a
 * naive window bound, `getTimezoneOffset()` re-reads) are switched to the
 * timestamptz form in the same change.
 *
 * NOT converted (the zone they were written in cannot be proved from this
 * code — nothing here writes them — or the value is a calendar date):
 * admin_configurations, cronbonus, fancymanualsettlement, fancyresultsummary,
 * gis_games, gis_prioritized_games, gis_prioritized_types, manual_settle,
 * prioritized_games, provider_games, staff_whatsapp_ref, transactions,
 * inr_deposit (`date` is a staff-entered calendar day).
 *
 * Idempotent: each column converts only while it is still zone-less, and a
 * missing table or column is skipped.
 */

const COLUMNS = Object.freeze({
  apaydeposits: ['created_at', 'updated_at'],
  apaywithdrawals: ['created_at', 'updated_at'],
  bonusgame: ['createdat', 'updatedat'],
  bonushistory: ['createdat', 'updatedat'],
  ccdeposit: ['created_at', 'updated_at'],
  club_earnings_configurations: ['created_at', 'updated_at'],
  cricpaytransactions: ['created_at', 'updated_at'],
  currency_payment_details: ['created_at', 'updated_at'],
  exchangerate: ['last_updated'],
  fanwins: ['created_at'],
  gift_cards: ['created_at', 'updated_at'],
  gis_providers_new: ['created_at'],
  gis_recently_played: ['played_at'],
  gisgamesnew: ['created_at'],
  redeembonus: ['applied_at', 'createdat', 'updatedat'],
  sportsbook_sessions: ['closed_at', 'created_at', 'updated_at'],
  team: ['createdAt', 'updatedAt'],
  user_2fa: ['created_at', 'updated_at'],
  user_exposures: ['created_at', 'updated_at'],
  user_gift_cards: ['created_at', 'start_date', 'updated_at'],
  user_login_history: ['created_at'],
  userbonus: ['createdat', 'updatedat'],
  users: ['last_login_at'],
  vault_pro: ['createdAt', 'incomeDate', 'updatedAt'],
  wager_multiplier_common: ['created_at', 'updated_at'],
});

const NAIVE = 'timestamp without time zone';
const AWARE = 'timestamp with time zone';

const quote = (name) => `"${name.replace(/"/g, '""')}"`;

/** `{ 'table.column': data_type }` for every listed column that exists. */
async function typesOf(sequelize, transaction) {
  const [rows] = await sequelize.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name IN (:tables)`,
    { replacements: { tables: Object.keys(COLUMNS) }, transaction }
  );
  return new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type]));
}

/** One ALTER TABLE per table (one rewrite), over the columns still of type `from`. */
async function convert({ sequelize, transaction, logger }, from, to) {
  const types = await typesOf(sequelize, transaction);
  const changed = [];
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const pending = columns.filter((c) => types.get(`${table}.${c}`) === from);
    if (!pending.length) continue;
    const clauses = pending.map(
      (c) => `ALTER COLUMN ${quote(c)} TYPE ${to} USING ${quote(c)} AT TIME ZONE 'UTC'`
    );
    await sequelize.query(`ALTER TABLE ${quote(table)} ${clauses.join(', ')}`, { transaction });
    changed.push(...pending.map((c) => `${table}.${c}`));
  }
  logger?.info(
    changed.length ? `${changed.length} column(s) → ${to} (stored values read as UTC): ${changed.join(', ')}` : `nothing to convert to ${to}`
  );
}

async function up(context) {
  await convert(context, NAIVE, AWARE);
}

async function down(context) {
  await convert(context, AWARE, NAIVE);
}

module.exports = { up, down, COLUMNS };

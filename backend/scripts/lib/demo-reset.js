'use strict';

/**
 * `--reset-demo` — remove every demo account and everything hanging off it.
 *
 * ── WHAT COUNTS AS DEMO ──────────────────────────────────────────────────
 *
 * Exactly the rows whose `name` or `email` starts with `demo_` — players in
 * `users`, staff in `staff`. Nothing else is touched: no configuration, no
 * role, no row of a real account. That prefix is why every demo dataset
 * names its accounts `demo_…`.
 *
 * ── ORDER AND ATOMICITY ──────────────────────────────────────────────────
 *
 * One transaction, children first: bonus wagers before bonuses, ledger and
 * history before the wallet, everything keyed on a player before `users`,
 * `users` (whose `parent_staff_id` points at staff) before `staff`, and the
 * staff tree's self-reference cut before its rows go. Either the whole demo
 * cast leaves or none of it does.
 *
 * Two things refuse the reset rather than guess:
 *   - a NON-demo player owned by a demo agent (someone created a real-looking
 *     player under `demo_agent` in the admin), and
 *   - a NON-demo staff account under a demo one.
 * Deleting the demo parent would orphan them, and deleting them is not ours.
 *
 * Without `--yes` it is a dry run: the same queries, counted, nothing deleted.
 */

const { QueryTypes } = require('sequelize');

const DEMO_LIKE = "LIKE 'demo\\_%'";

/**
 * Tables keyed on a player id, children before parents. A table or column
 * that does not exist on this database is skipped — the schema has legacy
 * tables some deployments never had.
 */
const USER_KEYED = [
  ['player_bonus_wagers', 'user_id'],
  ['player_bonuses', 'user_id'],
  ['tips', 'from_user_id'],
  ['tips', 'to_user_id'],
  ['credits_ledger', 'user_id'],
  ['wallet_history', 'uid'],
  ['wallet_balances', 'uid'],
  ['credits', 'uid'],
  ['wallets', 'uid'],
  // Stake reversals (migration 090): the applied-reversal log and the retry outbox.
  ['wager_reversals', 'user_id'],
  ['wager_reverse_outbox', 'user_id'],
  ['wager_activity', 'user_id'],
  ['userwager_history', 'uid'],
  ['userwager', 'uid'],
  ['rakeback_accruals', 'user_id'],
  ['vault_interest_history', 'userid'],
  ['vault_transactions', 'userid'],
  ['vault_pro', 'userid'],
  ['user_kyc', 'user_id'],
  ['user_notifications', 'user_id'],
  ['user_fcm_tokens', 'user_id'],
  ['auth_sessions', 'user_id'],
  ['auth_verification_tokens', 'user_id'],
  ['user_otps', 'user_id'],
  ['user_2fa', 'uid'],
  ['user_login_history', 'user_id'],
  ['rewards', 'owner_id'],
  ['unlocked_rewards', 'uid'],
  ['fiat_deposits', 'user_id'],
  ['fiat_withdrawals', 'uid'],
  ['user_bank_accounts', 'user_id'],
  ['user_withdrawal_whitelist', 'user_id'],
  ['userconfig', 'uid'],
  ['userbonus', 'userid'],
  ['bonus_history', 'userid'],
  ['bonushistory', 'userid'],
  ['bonusgame', 'userid'],
  ['cronbonus', 'userid'],
  ['redeembonus', 'userid'],
  ['spin_wheel_claims', 'user_id'],
  ['user_gift_cards', 'user_id'],
  ['race_rewards', 'user_id'],
  ['race_boat', 'user_id'],
  ['challenge_rewards', 'user_id'],
  ['swap_history', 'uid'],
  ['user_exposures', 'user_id'],
  ['user_transaction_stats', 'user_id'],
  ['user_favourite_games', 'user_id'],
  ['user_medals', 'user_id'],
  ['tier_assignments', 'user_id'],
  ['club_memberships', 'user_id'],
  ['club_notification_status', 'user_id'],
  ['club_banner_notification_status', 'user_id'],
  ['deposits', 'uid'],
  ['withdrawals', 'uid'],
  ['inr_deposit', 'uid'],
  ['upideposit', 'uid'],
  ['ccdeposit', 'userid'],
  ['apaydeposits', 'user_id'],
  ['apaywithdrawals', 'user_id'],
  ['pay_in_transactions', 'user_id'],
  ['pay_out_transactions', 'user_id'],
  ['psp_callback_log', 'user_id'],
  ['p2p_orders', 'user_id'],
  ['p2p_orders_sell', 'user_id'],
  ['p2p_disputes', 'user_id'],
  // Play history, in case someone played with a demo account after seeding.
  ['bets', 'uid'],
  ['in_house_rounds', 'user_id'],
  ['game_transactions', 'user_id'],
  ['game_sessions', 'user_id'],
  ['game_runs', 'user_id'],
  ['js_game_transactions', 'user_id'],
  ['js_game_sessions', 'user_id'],
  ['gis_transactions', 'user_id'],
  ['gis_sessions', 'user_id'],
  ['gis_recently_played', 'user_id'],
  ['gis_freespins', 'user_id'],
  ['gis_freevouchers', 'user_id'],
  ['seamless_transactions', 'user_id'],
  ['aggregator_transactions', 'user_id'],
  ['transactionscasino', 'user_id'],
  ['sportsbook_sessions', 'user_id'],
  ['SportsBet', 'user_id'],
];

const NUMERIC_TYPES = new Set(['bigint', 'integer', 'smallint', 'numeric']);

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function columnTypes(sequelize, transaction) {
  const rows = await sequelize.query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = current_schema()`,
    { type: QueryTypes.SELECT, transaction }
  );
  const map = new Map();
  for (const r of rows) map.set(`${r.table_name}.${r.column_name}`, r.data_type);
  return map;
}

/**
 * Plan (and, with `apply`, run) the reset.
 *
 * @returns {{ users, staff, steps: [{ label, count }], blocked: string[] }}
 */
async function resetDemo({ sequelize, apply, logger }) {
  const run = async (transaction) => {
    const q = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
    const users = await q(`SELECT id, name, email FROM users WHERE name ${DEMO_LIKE} OR email ${DEMO_LIKE}`);
    const staff = await q(`SELECT id, name, email FROM staff WHERE name ${DEMO_LIKE} OR email ${DEMO_LIKE}`);

    const userIds = users.map((u) => String(u.id));
    const staffIds = staff.map((s) => String(s.id));
    const names = [...new Set([...users, ...staff].flatMap((r) => [r.name, r.email]).filter(Boolean).map((v) => String(v).toLowerCase()))];
    const playerNames = users.map((u) => u.name);

    const steps = [];
    const blocked = [];

    if (staffIds.length) {
      const [orphanPlayers] = await q(
        `SELECT COUNT(*)::int AS n FROM users
          WHERE parent_staff_id IN (:staffIds) AND NOT (name ${DEMO_LIKE} OR COALESCE(email, '') ${DEMO_LIKE})`,
        { staffIds }
      );
      if (orphanPlayers.n) blocked.push(`${orphanPlayers.n} non-demo player(s) are owned by a demo staff account`);
      const [orphanStaff] = await q(
        `SELECT COUNT(*)::int AS n FROM staff
          WHERE parent_id IN (:staffIds) AND NOT (name ${DEMO_LIKE} OR email ${DEMO_LIKE})`,
        { staffIds }
      );
      if (orphanStaff.n) blocked.push(`${orphanStaff.n} non-demo staff account(s) sit under a demo staff account`);
    }
    if (blocked.length) return { users, staff, steps, blocked };

    const types = await columnTypes(sequelize, transaction);
    const exists = (table, column) => types.has(`${table}.${column}`);

    /** Count, then (when applying) delete, rows matched by `where`. */
    const step = async (label, table, where, replacements) => {
      const from = `FROM ${quoteIdent(table)} WHERE ${where}`;
      const [{ n }] = await q(`SELECT COUNT(*)::int AS n ${from}`, replacements);
      if (n && apply) await sequelize.query(`DELETE ${from}`, { replacements, transaction });
      if (n) steps.push({ label, count: n });
    };

    if (userIds.length) {
      for (const [table, column] of USER_KEYED) {
        if (!exists(table, column)) continue;
        const numeric = NUMERIC_TYPES.has(types.get(`${table}.${column}`));
        await step(`${table}.${column}`, table, `${quoteIdent(column)} IN (:ids)`, {
          ids: numeric ? userIds.map(Number) : userIds,
        });
      }
      if (exists('login_history', 'user_type')) {
        await step('login_history (players)', 'login_history', "user_id IN (:ids) AND COALESCE(user_type, 'user') <> 'staff'", { ids: userIds.map(Number) });
      }
    }

    // Name-keyed legacy tables: the affiliate tree is joined on usernames.
    if (playerNames.length) {
      // Rows already matched by id above are excluded, so a dry run does not count them twice.
      const byId = { rewards: 'owner_id', unlocked_rewards: 'uid' };
      for (const table of ['team', 'rewards', 'unlocked_rewards']) {
        if (!exists(table, 'ownername')) continue;
        const idColumn = byId[table] && exists(table, byId[table]) ? byId[table] : null;
        await step(
          `${table} (by name)`,
          table,
          `(ownername IN (:names) OR membername IN (:names))${idColumn ? ` AND (${idColumn} IS NULL OR ${idColumn} NOT IN (:ids))` : ''}`,
          { names: playerNames, ids: userIds.length ? userIds.map(Number) : [-1] }
        );
      }
    }
    if (names.length && exists('auth_login_attempts', 'identifier')) {
      await step('auth_login_attempts', 'auth_login_attempts', 'lower(identifier) IN (:names)', { names });
    }

    if ((userIds.length || staffIds.length) && exists('staff_transfers', 'from_id')) {
      await step(
        'staff_transfers',
        'staff_transfers',
        `(from_type = 'user' AND from_id IN (:u)) OR (to_type = 'user' AND to_id IN (:u))
          OR (from_type = 'staff' AND from_id IN (:s)) OR (to_type = 'staff' AND to_id IN (:s))`,
        // `IN ()` is a syntax error; -1 matches no account.
        { u: userIds.length ? userIds.map(Number) : [-1], s: staffIds.length ? staffIds.map(Number) : [-1] }
      );
    }

    if (userIds.length) await step('users', 'users', 'id IN (:ids)', { ids: userIds.map(Number) });

    if (staffIds.length) {
      const ids = staffIds.map(Number);
      if (exists('login_history', 'user_type')) {
        await step('login_history (staff)', 'login_history', "user_id IN (:ids) AND user_type = 'staff'", { ids });
      }
      // executives / staff_balances / staff_hierarchy / admin_activity_logs /
      // branch_agents / staff_whatsapp_ref cascade from `staff`; counted for the summary.
      for (const [table, column] of [
        ['executives', 'parent_staff_id'], ['staff_balances', 'staff_id'], ['staff_hierarchy', 'descendant_id'],
        ['admin_activity_logs', 'staff_id'],
      ]) {
        if (!exists(table, column)) continue;
        await step(`${table} (cascade)`, table, `${quoteIdent(column)} IN (:ids)`, { ids });
      }
      // The tree's self-reference: cut it, then the rows can go in any order.
      if (apply) await sequelize.query('UPDATE staff SET parent_id = NULL WHERE id IN (:ids)', { replacements: { ids }, transaction });
      await step('staff', 'staff', 'id IN (:ids)', { ids });
    }

    return { users, staff, steps, blocked };
  };

  if (!apply) {
    // A dry run still runs inside a transaction that is rolled back, so the
    // counts are one consistent snapshot and nothing can be written by mistake.
    let out;
    try {
      await sequelize.transaction(async (transaction) => {
        out = await run(transaction);
        throw Object.assign(new Error('dry run'), { dryRun: true });
      });
    } catch (error) {
      if (!error.dryRun) throw error;
    }
    return out;
  }

  const out = await sequelize.transaction((transaction) => run(transaction));
  logger?.info({ users: out.users.length, staff: out.staff.length }, 'Demo data reset');
  return out;
}

module.exports = { resetDemo, USER_KEYED };

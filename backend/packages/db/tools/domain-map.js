'use strict';

/**
 * Which service owns which table.
 *
 * The database is shared, but ownership is not: exactly one service writes a
 * given table, and the others read it through that service's API. This map is
 * the written-down version of that rule — it drives the folder each generated
 * model lands in, and it is what you check when you are about to add a query to
 * the "wrong" service.
 *
 * Domains:
 *   core      — identity, balances, sessions. Owned by user-service.
 *   payments  — deposits, withdrawals, PSP integrations. Owned by user-service.
 *   casino    — slots, in-house games, providers, casino bets. Owned by casino-service.
 *   sports    — fixtures, markets, sports bets, settlement. Owned by sports-service.
 *   admin     — staff, roles, config, audit trails. Owned by admin-service.
 */

const DOMAIN_OWNER = {
  core: 'user-service',
  payments: 'user-service',
  casino: 'casino-service',
  sports: 'sports-service',
  admin: 'admin-service',
};

/** Explicit table -> domain assignments. Anything not listed falls to the pattern rules. */
const EXPLICIT = {
  // ── core: identity, money, sessions ─────────────────────────────────
  users: 'core',
  credits: 'core',
  credits_ledger: 'core',
  wallets: 'core',
  wallet_history: 'core',
  tokens: 'core',
  user_2fa: 'core',
  user_otps: 'core',
  user_kyc: 'core',
  user_login_history: 'core',
  userconfig: 'core',
  user_exposures: 'core',
  transactions: 'core',
  swap_history: 'core',
  exchangerate: 'core',
  notifications: 'core',
  messages: 'core',
  team: 'core',
  clubs: 'core',
  club_hierarchy: 'core',
  club_earnings_configurations: 'core',
  vault_pro: 'core',
  userwager: 'core',
  userwager_history: 'core',
  wager_multiplier_common: 'core',
  rewards: 'core',
  unlocked_rewards: 'core',
  redeembonus: 'core',
  userbonus: 'core',
  bonus_history: 'core',
  bonushistory: 'core',
  bonusgame: 'core',
  cronbonus: 'core',
  gift_cards: 'core',
  user_gift_cards: 'core',
  spin_wheel_config: 'core',
  spin_wheel_slices: 'core',
  spin_wheel_claims: 'core',
  chat_global: 'core',
  chat_brazil: 'core',
  logs: 'core',

  // ── payments ────────────────────────────────────────────────────────
  deposits: 'payments',
  withdrawals: 'payments',
  fiat_deposits: 'payments',
  fiat_withdrawals: 'payments',
  inr_deposit: 'payments',
  upideposit: 'payments',
  ccdeposit: 'payments',
  apaydeposits: 'payments',
  apaywithdrawals: 'payments',
  cricpaytransactions: 'payments',
  pay_in_transactions: 'payments',
  bank: 'payments',
  currency_payment_details: 'payments',

  // ── casino ──────────────────────────────────────────────────────────
  bets: 'casino',
  house: 'casino',
  crashs: 'casino',
  crash_games: 'casino',
  bots: 'casino',
  apigames: 'casino',
  provider_games: 'casino',
  indian_games: 'casino',
  live_casino: 'casino',
  popular_slots: 'casino',
  hot_games: 'casino',
  game_runs: 'casino',
  transaction_live: 'casino',
  transaction_slot: 'casino',

  // ── sports ──────────────────────────────────────────────────────────
  SportsBet: 'sports',
  sports_config: 'sports',
  // Written by the sports manual-settlement flow (legacy/mannualsettlement),
  // not by anything in casino. The name is a legacy misspelling of "manual".
  mannual_result: 'sports',
  fancymanualsettlement: 'sports',
  fancyresultsummary: 'sports',
  fanwins: 'sports',
  marketwins: 'sports',
  manual_settle: 'sports',
  line_runner_mapping: 'sports',

  // ── admin ───────────────────────────────────────────────────────────
  staff: 'admin',
  staff_balances: 'admin',
  staff_hierarchy: 'admin',
  staff_transfers: 'admin',
  staff_whatsapp_ref: 'admin',
  roles: 'admin',
  roles_keys: 'admin',
  executives: 'admin',
  executive_activity_logs: 'admin',
  admin_activity_logs: 'admin',
  admin_configurations: 'admin',
  settings: 'admin',
  siteconfig: 'admin',
  banners: 'admin',
  blogs: 'admin',
  maintenance: 'admin',
};

/** Pattern rules, applied in order, for tables not named explicitly above. */
const PATTERNS = [
  [/^sports?_/i, 'sports'],
  [/^SportsBet$/i, 'sports'],
  [/^fancy/i, 'sports'],
  [/^gis_?/i, 'casino'],
  [/^js_?game/i, 'casino'],
  [/^prioritized|^removed_prioritized/i, 'casino'],
  [/^bet(outcome|s)_/i, 'casino'],
  [/^session_\d/i, 'casino'],
  [/^windata_/i, 'casino'],
  [/^staff/i, 'admin'],
  [/^admin/i, 'admin'],
  [/^executive/i, 'admin'],
  [/deposit|withdraw|payment|transaction/i, 'payments'],
  [/^user|^club|^bonus|^wager/i, 'core'],
];

function domainFor(tableName) {
  if (EXPLICIT[tableName]) return EXPLICIT[tableName];
  for (const [pattern, domain] of PATTERNS) {
    if (pattern.test(tableName)) return domain;
  }
  return 'core';
}

module.exports = { domainFor, DOMAIN_OWNER, EXPLICIT, PATTERNS };

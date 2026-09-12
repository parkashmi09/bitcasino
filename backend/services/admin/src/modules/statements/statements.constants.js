'use strict';

/**
 * What a ledger row IS, and which tab it belongs on.
 *
 * The kind is the machine-readable fact; the label is what a human reads. They
 * are separate so a wording change never alters a filter.
 */
const KIND = Object.freeze({
  // Agent wallet movements
  DEPOSIT_UPLINE: 'DEPOSIT_UPLINE',
  WITHDRAW_UPLINE: 'WITHDRAW_UPLINE',
  DEPOSIT_AGENT: 'DEPOSIT_AGENT',
  COLLECTED_AGENT: 'COLLECTED_AGENT',
  DEPOSIT_PLAYER: 'DEPOSIT_PLAYER',
  COLLECTED_PLAYER: 'COLLECTED_PLAYER',

  // Player banking
  BANK_DEPOSIT: 'BANK_DEPOSIT',
  GATEWAY_DEPOSIT: 'GATEWAY_DEPOSIT',
  BANK_WITHDRAW: 'BANK_WITHDRAW',
  GATEWAY_WITHDRAW: 'GATEWAY_WITHDRAW',

  // Play
  SPORTS: 'SPORTS',
  CASINO: 'CASINO',
});

/** Which `?category=` filter each kind answers to. */
const KIND_CATEGORY = Object.freeze({
  [KIND.DEPOSIT_UPLINE]: 'money',
  [KIND.WITHDRAW_UPLINE]: 'money',
  [KIND.DEPOSIT_AGENT]: 'money',
  [KIND.COLLECTED_AGENT]: 'money',
  [KIND.DEPOSIT_PLAYER]: 'money',
  [KIND.COLLECTED_PLAYER]: 'money',
  [KIND.BANK_DEPOSIT]: 'money',
  [KIND.GATEWAY_DEPOSIT]: 'money',
  [KIND.BANK_WITHDRAW]: 'money',
  [KIND.GATEWAY_WITHDRAW]: 'money',
  [KIND.SPORTS]: 'sports',
  [KIND.CASINO]: 'casino',
});

const CATEGORIES = Object.freeze(['all', 'money', 'sports', 'casino']);

/**
 * `credits_ledger.reason` values that are sports settlement.
 *
 * The same list the reports module keeps, and for the same reason: legacy read
 * the whole table because the settlement worker was its only writer, and that
 * stopped being true in this port. Duplicated deliberately rather than shared —
 * one module reporting a balance sheet and another reporting a statement should
 * not silently change each other's arithmetic when someone edits a list.
 */
const SPORTS_LEDGER_REASONS = Object.freeze([
  'BET_STAKE',
  'BET_PAYOUT',
  'BET_REFUND',
  'BET_ROLLBACK',
  'VOID_AFTER_SETTLEMENT',
  'VOID_SINGLE_BET_AFTER_SETTLEMENT',
]);

/** Stakes that have left the wallet with no settlement row yet. */
const OPEN_BET_STATUSES = Object.freeze(['open', 'manual']);

/**
 * The provider's name for this platform's INR wallet.
 *
 * `gis_transactions.currency` says 'PKR' for INR. Filtering on 'INR' alone
 * silently drops every casino round from the statement.
 */
const CASINO_INR_CURRENCIES = Object.freeze(['INR', 'PKR']);

/**
 * Whose side of the P&L the headline figure reports.
 *
 * `player_pnl + = the player won`. `agent_pnl` is its negation — the house
 * keeps what the player loses. `headline` is whichever the SUBJECT of the
 * statement actually keeps, so the screen can say "TOTAL PROFIT" without the
 * caller working out the sign.
 */
const HEADLINE_FOR = Object.freeze({ AGENT: 'AGENT', PLAYER: 'PLAYER' });

/** Ledger page size. Legacy capped at 500; a printed statement is smaller. */
const MAX_PAGE_SIZE = 500;

/** Bet-list page size. Legacy capped at 200. */
const MAX_BET_PAGE_SIZE = 200;

/**
 * How far back a statement may reach.
 *
 * Legacy accepted no dates as "all time" and then read every transfer, deposit,
 * withdrawal, settlement and casino round the subject had ever produced into
 * memory to sort them. For a busy tree that is the whole history of the
 * platform in one array. All-time is still permitted for a single PLAYER; for
 * an AGENT, whose statement fans out over an entire downline, a range is
 * required.
 */
const MAX_RANGE_DAYS = 1100;

module.exports = {
  KIND,
  KIND_CATEGORY,
  CATEGORIES,
  SPORTS_LEDGER_REASONS,
  OPEN_BET_STATUSES,
  CASINO_INR_CURRENCIES,
  HEADLINE_FOR,
  MAX_PAGE_SIZE,
  MAX_BET_PAGE_SIZE,
  MAX_RANGE_DAYS,
};

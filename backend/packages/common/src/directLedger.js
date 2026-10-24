'use strict';

/**
 * The direct user's ledger — `mssports.point_ledger_direct` (migrations 116, 117).
 *
 * Rule (user, 2026-10-17): every balance change of a DIRECT user (`users.parent_staff_id IS NULL`),
 * in any currency, is one row there: what happened, the real move and the balance after. Agent
 * users keep their own `mssports.point_ledger` — never mixed.
 *
 * The row itself is written by a database trigger on `credits` / `wallet_balances`, so no path that
 * moves money can skip it. This is the ONE function every money path calls to say WHAT happened:
 * call it inside the same transaction, right before the balance update. The label lives for that
 * transaction only and the trigger clears it after one update, so call it again before the next.
 * For an agent user, or with no transaction, it is harmless (nothing is labelled / recorded).
 *
 *   await directLedgerContext(sequelize, transaction, {
 *     userId, eventType: 'BET_PLACED', category: 'SPORTS', ref: 'msd:123', betId, remark: 'Ind v Aus' });
 */

/** What a row is about. Readers filter on it (statement: ALL | SPORTS | CASINO …). */
const CATEGORY = Object.freeze({
  SPORTS: 'SPORTS',
  CASINO: 'CASINO',
  ORIGINAL_GAME: 'ORIGINAL_GAME',
  DEPOSIT: 'DEPOSIT',
  WITHDRAW: 'WITHDRAW',
  ADMIN: 'ADMIN',
  BONUS: 'BONUS',
  TRANSFER: 'TRANSFER',
  OTHER: 'OTHER',
});

/** Casino ref types the platform wallet sees (casino-service → WalletClient → WalletService). */
const CASINO_REFS = new Set(['GIS', 'JSGAMES', 'JSGAMES_TRANSFER', 'JSGAMES_TRANSFER_REVERSAL', 'SEAMLESS', 'AGGREGATOR', 'INHOUSE', 'XCASINO']);

/** A platform `credits_ledger` reason (+ refType) → category. */
function categoryFor(reason, refType) {
  const r = String(reason || '').toUpperCase();
  if (String(refType || '').toUpperCase() === 'OG') return CATEGORY.ORIGINAL_GAME;
  if (CASINO_REFS.has(String(refType || '').toUpperCase())) return CATEGORY.CASINO;
  if (r.startsWith('BET_')) return CATEGORY.CASINO;
  if (r === 'DEPOSIT') return CATEGORY.DEPOSIT;
  if (r.startsWith('WITHDRAWAL')) return CATEGORY.WITHDRAW;
  if (r === 'ADMIN_CREDIT' || r === 'ADMIN_DEBIT') return CATEGORY.ADMIN;
  if (['BONUS', 'BONUS_REVERSAL', 'CLAIM', 'RACE_REWARD_CLAIM'].includes(r)) return CATEGORY.BONUS;
  if (r.startsWith('TRANSFER') || r.startsWith('TIP_') || ['SELL_HOLD', 'SELL_REFUND', 'BUY_RELEASE'].includes(r)) return CATEGORY.TRANSFER;
  return CATEGORY.OTHER;
}

const text = (v, max) => (v == null || v === '' ? undefined : String(v).slice(0, max));

/**
 * Label the next balance update of `userId` in this transaction.
 * @param {import('sequelize').Sequelize} sequelize
 * @param {import('sequelize').Transaction|null|undefined} transaction  without one there is nothing to label
 * @param {{ userId, eventType, category?, ref?, source?, betId?, sportId?, gameType?, remark? }} label
 */
async function directLedgerContext(sequelize, transaction, label) {
  if (!transaction || !label?.userId) return;
  const ctx = {
    userId: String(label.userId),
    eventType: text(label.eventType, 40) || 'BALANCE_CHANGE',
    category: text(label.category, 30) || CATEGORY.OTHER,
    ref: text(label.ref, 160),
    source: text(label.source, 40),
    betId: label.betId != null ? String(label.betId) : undefined,
    sportId: text(label.sportId, 50),
    gameType: text(label.gameType, 50),
    remark: text(label.remark, 255),
  };
  await sequelize.query(`SELECT set_config('parker.ledger', :ctx, true)`, {
    replacements: { ctx: JSON.stringify(ctx) },
    transaction,
  });
}

module.exports = { directLedgerContext, categoryFor, CATEGORY };

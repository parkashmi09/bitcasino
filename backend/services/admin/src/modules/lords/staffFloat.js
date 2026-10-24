'use strict';

const { Op, literal, where: sqlWhere } = require('sequelize');
const { money, AppError } = require('@ibitplay/common');

/**
 * A staff member's own float — their `credits` row, read through the
 * `StaffCredits` model (migration 099; before that it was `staff_balances.inr`)
 * — and the credit line that lets it go below zero.
 *
 * The owner (Super Admin) has a row here too and pays from it like everyone
 * else. Only a DIRECT user (signed up on their own, no parent) is funded by the
 * owner without a debit — see `ownerWallet.js`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE CREDIT LIMIT
 *
 * `credits.credit_limit` (the staff row) is how far below zero an agent's float may go
 * when it FUNDS A PLAYER (a refill, a transfer to a player, an agent-tree
 * balance credit). The house extends the agent credit; the agent settles it
 * later. So the guard is
 *
 *     inr + credit_limit >= amount        (players)
 *     inr               >= amount         (everything else)
 *
 * evaluated by Postgres inside the UPDATE, under its own row lock — two
 * concurrent debits cannot both pass it. A transfer to another STAFF account
 * never draws on credit: an agent cannot lend its upline's credit onwards.
 *
 * `credit_limit` is 0 by default (the baseline default), so an agent with no
 * line set behaves exactly as before.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * ONE overdraw error for every staff money path — 422 `INSUFFICIENT_FUNDS`,
 * the same code `InsufficientFundsError` (packages/common) gives a player.
 *
 * It used to be three: 402 `STAFF_INSUFFICIENT_FUNDS` (staff transfer),
 * 422 `INSUFFICIENT_STAFF_BALANCE` (agent float) and 422
 * `PLAYERS_INSUFFICIENT_FUNDS` (funded player creation), plus 402
 * `ACCOUNTS_INSUFFICIENT_FUNDS` / `ACCOUNTS_PLAYER_INSUFFICIENT_FUNDS` in the
 * lords module. The hub admin UI never branched on any of them. Who was short
 * is in `details.party` (`staff` | `user`).
 */
const insufficientFunds = (details = {}, message = 'There is not enough balance to cover this') =>
  new AppError(message, 422, 'INSUFFICIENT_FUNDS', details);

/** The caller's own float (including any credit line) is short. */
const insufficientStaffBalance = (details = {}) =>
  insufficientFunds(
    { party: 'staff', ...details },
    'There is not enough in your own balance (including any credit line) to cover this'
  );

/** The player's wallet is short. */
const insufficientPlayerBalance = (details = {}) =>
  insufficientFunds({ party: 'user', ...details }, 'The player does not have enough balance for this');

/**
 * Take `amount` from a staff float, or refuse.
 *
 * @returns {Promise<boolean>} false when the guard refused it — nothing written.
 */
async function debitStaffFloat(models, staffId, amount, { transaction, allowCredit = false } = {}) {
  const minor = money.toDecimalString(money.toMinor(amount));

  const guard = allowCredit
    ? sqlWhere(literal('inr + COALESCE(credit_limit, 0)'), Op.gte, minor)
    : { inr: { [Op.gte]: minor } };

  const [affected] = await models.StaffCredits.update(
    { inr: literal(`inr - ${minor}`) },
    { where: { [Op.and]: [{ staff_id: staffId }, guard] }, transaction }
  );
  return affected > 0;
}

/** Add `amount` to a staff float, creating the row if the account has none. */
async function creditStaffFloat(models, staffId, amount, { transaction } = {}) {
  const minor = money.toDecimalString(money.toMinor(amount));
  const [, created] = await models.StaffCredits.findOrCreate({
    where: { staff_id: staffId },
    defaults: { staff_id: staffId, inr: minor },
    transaction,
  });
  if (!created) {
    await models.StaffCredits.increment({ inr: minor }, { where: { staff_id: staffId }, transaction });
  }
}

/** `{ balance, creditLimit, available }` for one staff float, as decimal strings. */
async function readStaffFloat(models, staffId, { transaction } = {}) {
  const row = await models.StaffCredits.findOne({
    where: { staff_id: staffId },
    attributes: ['inr', 'credit_limit'],
    transaction,
    raw: true,
  });
  const balance = money.toMinorQuantised(row?.inr ?? '0');
  const creditLimit = money.toMinorQuantised(row?.credit_limit ?? '0');
  return {
    balance: money.toDecimalString(balance),
    creditLimit: money.toDecimalString(creditLimit),
    available: money.toDecimalString(balance + creditLimit),
  };
}

module.exports = {
  debitStaffFloat,
  creditStaffFloat,
  readStaffFloat,
  insufficientFunds,
  insufficientStaffBalance,
  insufficientPlayerBalance,
};

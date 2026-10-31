'use strict';

/**
 * Manual deposit / withdrawal ON / OFF (`manual_payment_control`, migration 111) — Super Admin
 * ka switch, Admin → Transactions → Deposit / Withdraw → Manual.
 *
 * Fiat (bank transfer) deposit aur fiat withdrawal request banne se pehle ye poocha jaata hai.
 * Table na ho (purana DB) = ON, jaisa aaj chalta hai. Har call pe padhna, cache nahi.
 */

const { defineErrors } = require('./defineErrors');

const errors = defineErrors('MANUAL', {
  /** Code `MANUAL_DEPOSIT_DISABLED`. */
  DEPOSIT_DISABLED: { status: 403, message: 'Manual deposits are switched off right now.' },
  /** Code `MANUAL_WITHDRAW_DISABLED`. */
  WITHDRAW_DISABLED: { status: 403, message: 'Manual withdrawals are switched off right now.' },
});

/** `{ deposit, withdraw }` — dono boolean. */
async function readManualPayments(sequelize, transaction) {
  if (!sequelize?.query) return { deposit: true, withdraw: true };
  try {
    const [rows] = await sequelize.query(
      'SELECT manual_deposit_enabled, manual_withdraw_enabled FROM manual_payment_control WHERE id = 1',
      { transaction }
    );
    const row = rows[0];
    return { deposit: row ? row.manual_deposit_enabled !== false : true, withdraw: row ? row.manual_withdraw_enabled !== false : true };
  } catch (error) {
    if (error?.original?.code === '42P01' || error?.parent?.code === '42P01') return { deposit: true, withdraw: true };
    throw error;
  }
}

/** OFF ho to refuse. `kind`: 'deposit' | 'withdraw'. */
async function assertManualAllowed(sequelize, kind, { transaction } = {}) {
  const state = await readManualPayments(sequelize, transaction);
  if (kind === 'deposit' && !state.deposit) throw errors.DEPOSIT_DISABLED();
  if (kind === 'withdraw' && !state.withdraw) throw errors.WITHDRAW_DISABLED();
}

module.exports = { readManualPayments, assertManualAllowed, errors };

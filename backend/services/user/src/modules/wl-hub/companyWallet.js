'use strict';

const { QueryTypes } = require('sequelize');
const { AppError, money } = require('@ibitplay/common');

/**
 * A whitelabel copy's company balance (its Direct balance, `staff_balances.inr` of the level-1
 * staff) moved by gateway payments that ran on the parent's account. Owner's rule (2026-11-01):
 * the company balance is the money the parent holds for it.
 *
 *   gateway deposit A, charge d%      company +A, then −A·d%   (ledger gateway_deposit, gateway_charge)
 *   gateway withdrawal A, charge w%   company −A, then −A·w%   at request (gateway_withdrawal, gateway_charge)
 *   that withdrawal fails             company +A + A·w%        (gateway_refund)
 *
 * Amounts in another coin are counted in INR at the site's rates (`exchangerate.usd_rate`, USD per
 * unit). Every movement first claims its row in `whitelabel_gateway_movements` (PK provider,
 * reference, kind), in the caller's transaction, so a retry never moves the balance twice.
 * Ledger rows are `owner_direct_ledger` — the company's own statement — written the way
 * admin-service lords/ownerWallet writes them.
 */

const LEDGER = Object.freeze({
  DEPOSIT: 'gateway_deposit',
  WITHDRAWAL: 'gateway_withdrawal',
  CHARGE: 'gateway_charge',
  REFUND: 'gateway_refund',
});

const companyBalanceLow = (details) =>
  new AppError('The company balance cannot cover this withdrawal and its gateway charge', 409, 'COMPANY_BALANCE_LOW', details);

const select = (db, sql, replacements, transaction) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const dec = (minor) => money.toDecimalString(minor);

/** The company: this copy's first level-1 staff row (the one the parent created with it). */
async function companyId(db, transaction) {
  const [row] = await select(db, `SELECT s.id FROM staff s JOIN roles r ON r.id = s.role_id WHERE r.level = 1 ORDER BY s.id LIMIT 1`, {}, transaction);
  if (!row) throw new AppError('This whitelabel has no company account', 500, 'WHITELABEL_NO_COMPANY');
  return Number(row.id);
}

/** `amount` of `currency` in INR at the site's rates. */
async function toInr(db, currency, amount, transaction) {
  const code = String(currency).toUpperCase();
  if (code === 'INR') return money.fromStored(amount);
  const rows = await select(db, `SELECT UPPER(currency) AS currency, usd_rate FROM exchangerate WHERE UPPER(currency) IN ('INR', :code)`, { code }, transaction);
  const rate = Object.fromEntries(rows.map((r) => [r.currency, r.usd_rate == null ? null : money.fromStored(r.usd_rate)]));
  if (!rate[code] || !rate.INR || money.isZero(rate.INR)) throw new AppError(`No exchange rate for ${code}`, 500, 'NO_EXCHANGE_RATE', { currency: code });
  // USD = amount × usd_rate[code]; INR = USD ÷ usd_rate[INR].
  return dec(money.divide(dec(money.multiply(money.fromStored(amount), rate[code])), rate.INR));
}

/** The charge on `amountInr` at `pct` percent, rounded half-up to the paisa. */
const PAISA = 10n ** BigInt(money.SCALE - 2);
function chargeOf(amountInr, pct) {
  const minor = money.percentOf(amountInr, String(pct));
  return dec(((minor + PAISA / 2n) / PAISA) * PAISA);
}

async function ledger(db, { ownerId, type, direction, amount, after, note, currency, currencyAmount }, transaction) {
  const afterMinor = money.toMinorQuantised(after);
  const amountMinor = money.toMinor(amount);
  const beforeMinor = direction === 'credit' ? afterMinor - amountMinor : afterMinor + amountMinor;
  await db.sequelize.query(
    `INSERT INTO owner_direct_ledger
       (owner_id, entry_type, direction, amount, balance_before, balance_after, user_id, note, currency, currency_amount, created_at)
     VALUES (:ownerId, :type, :direction, :amount, :before, :after, NULL, :note, :currency, :currencyAmount, NOW())`,
    {
      replacements: {
        ownerId,
        type,
        direction,
        amount,
        before: dec(beforeMinor),
        after: dec(afterMinor),
        note: note ? String(note).slice(0, 255) : null,
        currency: currency ?? null,
        currencyAmount: currencyAmount ?? null,
      },
      transaction,
    }
  );
}

/** Claim (provider, reference, kind). False = already moved: do nothing. */
async function claim(db, row, transaction) {
  const claimed = await select(
    db,
    `INSERT INTO whitelabel_gateway_movements (provider, reference, kind, currency, amount, amount_inr, charge_pct, charge_inr, staff_id)
     VALUES (:provider, :reference, :kind, :currency, :amount, :amountInr, :chargePct, :chargeInr, :staffId)
     ON CONFLICT (provider, reference, kind) DO NOTHING RETURNING kind`,
    row,
    transaction
  );
  return claimed.length > 0;
}

async function credit(db, ownerId, amount, transaction) {
  const [row] = await select(
    db,
    `INSERT INTO staff_balances (staff_id, inr) VALUES (:ownerId, :amount)
     ON CONFLICT (staff_id) DO UPDATE SET inr = staff_balances.inr + EXCLUDED.inr RETURNING inr`,
    { ownerId, amount },
    transaction
  );
  return row.inr;
}

/** Plain debit (may go below zero — used only right after a larger credit). */
async function debit(db, ownerId, amount, transaction) {
  const [row] = await select(db, 'UPDATE staff_balances SET inr = inr - :amount WHERE staff_id = :ownerId RETURNING inr', { ownerId, amount }, transaction);
  return row.inr;
}

/** A gateway deposit reached the player: the company gets the amount, less the charge. */
async function onDeposit(db, { provider, reference, currency, amount, chargePct }, transaction) {
  const staffId = await companyId(db, transaction);
  const amountInr = await toInr(db, currency, amount, transaction);
  const chargeInr = chargeOf(amountInr, chargePct);
  if (!(await claim(db, { provider, reference, kind: 'deposit', currency, amount, amountInr, chargePct, chargeInr, staffId }, transaction))) return null;

  const coin = String(currency).toUpperCase() === 'INR' ? {} : { currency: String(currency).toUpperCase(), currencyAmount: amount };
  let after = await credit(db, staffId, amountInr, transaction);
  await ledger(db, { ownerId: staffId, type: LEDGER.DEPOSIT, direction: 'credit', amount: amountInr, after, note: `${provider} deposit ${reference}`, ...coin }, transaction);
  if (!money.isZero(chargeInr)) {
    after = await debit(db, staffId, chargeInr, transaction);
    await ledger(db, { ownerId: staffId, type: LEDGER.CHARGE, direction: 'debit', amount: chargeInr, after, note: `${chargePct}% ${provider} deposit charge ${reference}` }, transaction);
  }
  return { amountInr, chargeInr };
}

/**
 * A gateway withdrawal is requested: the company pays the amount and the charge now, guarded
 * (COMPANY_BALANCE_LOW, nothing written). Run in the same transaction as the player's hold.
 */
async function onWithdrawal(db, { provider, reference, currency, amount, chargePct }, transaction) {
  const staffId = await companyId(db, transaction);
  const amountInr = await toInr(db, currency, amount, transaction);
  const chargeInr = chargeOf(amountInr, chargePct);
  const total = dec(money.add(amountInr, chargeInr));
  if (!(await claim(db, { provider, reference, kind: 'withdrawal', currency, amount, amountInr, chargePct, chargeInr, staffId }, transaction))) return null;

  const rows = await select(
    db,
    'UPDATE staff_balances SET inr = inr - :total WHERE staff_id = :staffId AND inr >= :total RETURNING inr',
    { total, staffId },
    transaction
  );
  if (!rows.length) throw companyBalanceLow({ needed: total });
  const after = rows[0].inr;
  const coin = String(currency).toUpperCase() === 'INR' ? {} : { currency: String(currency).toUpperCase(), currencyAmount: amount };
  // Two statement rows: the withdrawal, then its charge (balance_after of the first is before the charge).
  await ledger(db, { ownerId: staffId, type: LEDGER.WITHDRAWAL, direction: 'debit', amount: amountInr, after: dec(money.add(money.fromStored(after), chargeInr)), note: `${provider} withdrawal ${reference}`, ...coin }, transaction);
  if (!money.isZero(chargeInr)) {
    await ledger(db, { ownerId: staffId, type: LEDGER.CHARGE, direction: 'debit', amount: chargeInr, after, note: `${chargePct}% ${provider} withdrawal charge ${reference}` }, transaction);
  }
  return { amountInr, chargeInr };
}

/** That withdrawal failed: the company gets back what it paid, once. Null = nothing was taken. */
async function onWithdrawalFailed(db, { provider, reference }, transaction) {
  const [taken] = await select(
    db,
    `SELECT currency, amount, amount_inr, charge_pct, charge_inr, staff_id FROM whitelabel_gateway_movements WHERE provider = :provider AND reference = :reference AND kind = 'withdrawal'`,
    { provider, reference },
    transaction
  );
  if (!taken) return null;
  const total = dec(money.add(money.fromStored(taken.amount_inr), money.fromStored(taken.charge_inr)));
  const row = { provider, reference, kind: 'withdrawal_refund', currency: taken.currency, amount: taken.amount, amountInr: taken.amount_inr, chargePct: taken.charge_pct, chargeInr: taken.charge_inr, staffId: taken.staff_id };
  if (!(await claim(db, row, transaction))) return null;
  const after = await credit(db, Number(taken.staff_id), total, transaction);
  await ledger(db, { ownerId: Number(taken.staff_id), type: LEDGER.REFUND, direction: 'credit', amount: total, after, note: `${provider} withdrawal ${reference} failed — amount and charge back` }, transaction);
  return { total };
}

module.exports = { LEDGER, onDeposit, onWithdrawal, onWithdrawalFailed, toInr, chargeOf, companyId };

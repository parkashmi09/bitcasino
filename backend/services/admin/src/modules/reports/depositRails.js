'use strict';

const { COIN_IDS, DEPOSIT_SUCCESS } = require('../dashboard/dashboard.constants');

/**
 * REAL DEPOSITS — money a player paid in, on every rail, success statuses only. The one
 * definition the Dashboard, User reports, the Users page, the player header / Stats / Risk and
 * the account statement share, so they print the same number.
 *
 *   fiat_deposits        bank + manual crypto (TRC20 …)   currency
 *   apaydeposits         A-Pay gateway                    currency
 *   pay_in_transactions  WayPay                           currency
 *   ccdeposit            CCPayment crypto                 coinid → coin; `price`
 *   cricpaytransactions  CricPay                          INR
 *   f2paydeposits        F2Pay                            currency (INR)
 *   upideposit           legacy UPI                       INR (text uid / amount, no timestamp column)
 *
 * NOT deposits (owner, 19 Oct 2026): the Super Admin's Direct User Wallet credit (credits_ledger
 * ADMIN_CREDIT refType DIRECT_WALLET / owner_direct_ledger user_deposit) — reported as its own
 * "Admin credit" line. Agent funding (staff_transfers) is added by the callers that count it.
 *
 * Rows: `(uid bigint, at timestamptz, cur text, amt numeric, rail text)`.
 *
 * @param {object} o
 * @param {(column: string) => string} [o.range]  ' AND <column> in window', or ''
 * @param {(column: string, text: boolean) => string} [o.who]  ' AND <owner column> = …', or ''
 * @param {boolean} [o.currency]  filter on `:currency`
 */
function realDepositsSql({ range = () => '', who = () => '', currency = false } = {}) {
  const replacements = {
    rdFiat: DEPOSIT_SUCCESS.fiat_deposits,
    rdApay: DEPOSIT_SUCCESS.apaydeposits,
    rdPayIn: DEPOSIT_SUCCESS.pay_in_transactions,
    rdCc: DEPOSIT_SUCCESS.ccdeposit,
  };
  const coinCase = Object.entries(COIN_IDS)
    .map(([id, code]) => `WHEN ${Number(id)} THEN '${String(code).replace(/[^A-Z0-9]/g, '')}'`)
    .join(' ');
  const ccCurrency = `(CASE c.coinid ${coinCase} ELSE NULL END)`;
  const cur = (expr) => (currency ? ` AND UPPER(${expr}) = :currency` : '');
  // shortcut: upideposit has only a free-text `transactiondate`; an ISO-looking one is used, any other is outside every window.
  const upiAt = `(CASE WHEN u.transactiondate ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])' THEN LEFT(u.transactiondate, 10)::date::timestamptz END)`;

  const sql = [
    `SELECT d.user_id::bigint AS uid, d.created_at AS at, UPPER(d.currency) AS cur, d.amount AS amt, 'bank' AS rail
       FROM fiat_deposits d
      WHERE LOWER(d.status) IN (:rdFiat)${range('d.created_at')}${who('d.user_id', false)}${cur('d.currency')}`,
    `SELECT a.user_id::bigint, a.created_at, UPPER(a.currency), a.amount, 'apay'
       FROM apaydeposits a
      WHERE LOWER(a.status) IN (:rdApay)${range('a.created_at')}${who('a.user_id', false)}${cur('a.currency')}`,
    `SELECT p.user_id::bigint, p.created_at, UPPER(p.currency), p.amount, 'waypay'
       FROM pay_in_transactions p
      WHERE p.status IN (:rdPayIn)${range('p.created_at')}${who('p.user_id', false)}${cur('p.currency')}`,
    `SELECT CASE WHEN c.userid ~ '^[0-9]{1,18}$' THEN c.userid::bigint END, c.created_at, ${ccCurrency}, c.price, 'ccpayment'
       FROM ccdeposit c
      WHERE LOWER(c.status) IN (:rdCc)${range('c.created_at')}${who('c.userid', true)}${cur(ccCurrency)}`,
    `SELECT k.uid::bigint, k.created_at, 'INR', k.amount, 'cricpay'
       FROM cricpaytransactions k
      WHERE LOWER(k.status) = 'successful'${range('k.created_at')}${who('k.uid', false)}${cur("'INR'")}`,
    `SELECT fp.user_id, fp.created_at, UPPER(fp.currency), fp.amount, 'f2pay'
       FROM f2paydeposits fp
      WHERE LOWER(fp.status) = 'success'${range('fp.created_at')}${who('fp.user_id', false)}${cur('fp.currency')}`,
    `SELECT CASE WHEN u.uid ~ '^[0-9]{1,18}$' THEN u.uid::bigint END, ${upiAt}, 'INR',
            CASE WHEN u.amount ~ '^[0-9]+(\\.[0-9]+)?$' THEN u.amount::numeric ELSE 0 END, 'upi'
       FROM upideposit u
      WHERE LOWER(u.status) = 'success'${range(upiAt)}${who('u.uid', true)}${cur("'INR'")}`,
  ].join('\n UNION ALL \n');

  return { sql, replacements };
}

module.exports = { realDepositsSql };

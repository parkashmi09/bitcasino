'use strict';

/**
 * The tables a player's statement is actually spread across.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS LIST EXISTS
 *
 * `combined()` used to read three tables — `deposits`, `fiat_deposits`,
 * `fiat_withdrawals` — and call that a player's history. It is not. Legacy's
 * `GET /api/depositNew` read FOUR deposit tables and `GET /api/withdrawNew`
 * read THREE withdrawal tables, and the new backend writes to all of them:
 *
 *   ccdeposit             crypto checkout orders   modules/crypto
 *   fiat_deposits         manual bank transfers    modules/fiat-deposit
 *   apaydeposits          A-Pay rail               modules/psp
 *   pay_in_transactions   WayPay rail              modules/psp
 *
 *   withdrawals           crypto payouts           modules/crypto-withdraw
 *   fiat_withdrawals      manual bank payouts      modules/fiat-withdraw
 *   apaywithdrawals       A-Pay payouts            modules/psp
 *   f2paywithdrawals      F2Pay payouts            modules/payment-orders
 *
 * `deposits` is NOT in that list. Nothing in the new backend writes it — only
 * `legacy/Wallet/Deposit.js` ever did — so a history built from it shows a
 * player none of the deposits they have made since the port. It stays reachable
 * through `cryptoDeposits()` for the historical rows it holds, but it is not
 * what "my deposits" means any more.
 *
 * DESCRIBED, NOT UNION'd. The seven tables agree on neither column names, id
 * types, date columns, nor status vocabulary — `apaydeposits.user_id` is BIGINT
 * and `apaywithdrawals.user_id` is VARCHAR(200), the same integration
 * disagreeing with itself. A `UNION ALL` over that needs a cast in every branch
 * and hides the disagreement inside a 200-line string. Here each rail is
 * queried through its own model and the differences are visible in one place.
 * `modules/deposit-reports` describes the same problem the same way.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * A provider status as one word.
 *
 * WayPay stores `status` as a SMALLINT, so a player's history would otherwise
 * show "0" next to "pending" and "approved" and mean the same thing three ways.
 *
 * Legacy's version of this mapped 2 onto 'pending'. 2 is FAILED — its own
 * `depositReports` constants say so, and the PSP callback writes 2 on failure —
 * so a failed WayPay deposit read as still in flight.
 */
function normaliseStatus(status) {
  if (status === undefined || status === null) return 'pending';
  if (typeof status === 'number') {
    if (status === 1) return 'approved';
    if (status === 2) return 'failed';
    return 'pending';
  }
  return String(status).toLowerCase();
}

/**
 * The exact inverse of `normaliseStatus` for the one rail that stores a number.
 *
 * A caller filtering by status names it in words. Comparing the word 'pending'
 * against a SMALLINT column is a Postgres type error, not an empty result, so
 * the WayPay rail needs the word turned back into its number before the query
 * is built. Every other rail stores text and is matched case-insensitively.
 *
 * ONLY the three words `normaliseStatus` can produce are here, deliberately.
 * Accepting synonyms — 'success' for 1, say — would return WayPay rows under a
 * filter whose own answer displays them as 'approved', so a client filtering
 * the list it was given would drop the rows the server just selected. A filter
 * has to match what the caller can see.
 */
const NUMERIC_STATUS = Object.freeze({ approved: 1, failed: 2, pending: 0 });

/**
 * One deposit rail.
 *
 * `userIdIsText` mirrors `payment-orders`' USER_ID_IS_TEXT — the same list,
 * checked by `tools/verify-models.js` against the live schema.
 *
 * `present` maps a raw row onto the one shape every rail returns, so the screen
 * consuming this has no branch per provider. Legacy returned crypto and fiat
 * under keys shaped differently from each other and the client had a branch per
 * type; that branch is what broke when the shapes moved.
 */
const DEPOSIT_SOURCES = Object.freeze([
  {
    method: 'crypto',
    type: 'Crypto',
    model: 'Ccdeposit',
    userColumn: 'userid',
    userIdIsText: true,
    dateColumn: 'created_at',
    orderColumn: 'id',
    // `coinid` is CCPayment's own number, not a ticker — see `ccpaymentTicker`.
    coinIdColumn: 'coinid',
    present: (row, { ticker }) => ({
      id: row.id,
      reference: row.orderid ?? null,
      // `price` is what the order was raised for, `amount` what arrived.
      amount: row.amount ?? row.price,
      currency: ticker,
      status: row.status,
      details: `Order: ${row.orderid ?? 'N/A'}`,
      date: row.created_at,
    }),
  },
  {
    method: 'manual',
    type: 'Fiat',
    model: 'FiatDeposits',
    userColumn: 'user_id',
    userIdIsText: false,
    dateColumn: 'created_at',
    orderColumn: 'deposit_id',
    currencyColumn: 'currency',
    present: (row) => ({
      id: row.deposit_id,
      reference: row.transaction_id ?? null,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      details: `Txn: ${row.transaction_id ?? 'N/A'}`,
      date: row.created_at,
    }),
  },
  {
    method: 'apay',
    type: 'Fiat',
    model: 'Apaydeposits',
    userColumn: 'user_id',
    userIdIsText: false,
    dateColumn: 'created_at',
    orderColumn: 'id',
    currencyColumn: 'currency',
    present: (row) => ({
      id: row.id,
      reference: row.custom_transaction_id ?? row.order_id ?? null,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      details: `Txn: ${row.custom_transaction_id ?? 'N/A'}`,
      date: row.created_at,
    }),
  },
  {
    method: 'waypay',
    type: 'Fiat',
    model: 'PayInTransactions',
    userColumn: 'user_id',
    userIdIsText: false,
    dateColumn: 'created_at',
    orderColumn: 'id',
    currencyColumn: 'currency',
    // `status` is a SMALLINT here and text everywhere else — see NUMERIC_STATUS.
    statusIsNumeric: true,
    present: (row) => ({
      id: row.id,
      reference: row.out_trade_no ?? row.transaction_id ?? null,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      details: `Type: ${row.pay_type ?? 'N/A'}`,
      date: row.created_at,
    }),
  },
  {
    method: 'f2pay',
    type: 'Fiat',
    model: 'F2payDeposits',
    userColumn: 'user_id',
    userIdIsText: false,
    dateColumn: 'created_at',
    orderColumn: 'id',
    currencyColumn: 'currency',
    present: (row) => ({
      id: row.id,
      reference: row.mch_order_no,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      details: `UTR: ${row.utr_number ?? 'N/A'}`,
      date: row.created_at,
    }),
  },
]);

/**
 * One withdrawal rail.
 *
 * The destination account is included because a player looking at their own
 * payout history needs to know WHICH account it went to — that is the whole
 * question when one of them fails. The wallet address on the crypto rail is
 * masked for the same reason `crypto-withdraw` masks it: it is a permanent
 * on-chain identifier, and the player already knows their own.
 */
/**
 * The last four digits of an account number, or `null`. The crypto rail is
 * handed a `maskWallet` by the service for the same job; this one is local
 * because only the fiat source needs it and the shape is different — a bank
 * account is recognised by its tail, where a wallet needs both ends.
 */
const maskTail = (value) => {
  const text = String(value ?? '');
  if (!text) return null;
  return text.length <= 4 ? text : `••••${text.slice(-4)}`;
};

const WITHDRAWAL_SOURCES = Object.freeze([
  {
    method: 'crypto',
    type: 'Crypto',
    model: 'Withdrawals',
    userColumn: 'uid',
    userIdIsText: false,
    dateColumn: 'date',
    orderColumn: 'id',
    currencyColumn: 'coin',
    present: (row, { maskWallet }) => ({
      id: row.id,
      reference: row.txid ?? null,
      amount: row.amount,
      currency: row.coin,
      status: row.status,
      details: `${row.chain ? `${row.chain}: ` : ''}${maskWallet(row.wallet)}`,
      destination: {
        wallet: maskWallet(row.wallet),
        chain: row.chain ?? null,
      },
      date: row.date,
    }),
  },
  {
    method: 'manual',
    type: 'Fiat',
    model: 'FiatWithdrawals',
    userColumn: 'uid',
    userIdIsText: false,
    dateColumn: 'date',
    orderColumn: 'id',
    currencyColumn: 'currency',
    present: (row) => ({
      id: row.id,
      reference: null,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      /**
       * THE ACCOUNT NUMBER IS MASKED, AND `ifscCode` IS GONE, BECAUSE THIS FILE
       * AND THE FIAT RAIL'S OWN SERVICE USED TO DISAGREE.
       *
       * `FiatWithdrawService.#present` puts `account_number` and `ifsc_code`
       * behind its `forStaff` gate, so `GET /user/withdrawals/fiat` never sends
       * them. This source handed both to the same player on the same record —
       * their own details either way, so nothing leaked to a stranger, but the
       * two modules plainly disagreed and a reader of either would draw the
       * wrong conclusion about the other.
       *
       * Settled towards the narrower of the two, which is also what the crypto
       * rail beside it already does: it masks the destination wallet rather
       * than printing it. A masked tail is what a player needs to recognise
       * which account they used; the full number adds nothing on a history
       * screen and is the part worth not repeating back over the wire.
       */
      // A UPI payout has no bank or account number — name its UPI id instead.
      details: row.upi_id && !row.account_number ? `UPI: ${row.upi_id}` : `Bank: ${row.bank_name ?? 'N/A'}, Acc: ${maskTail(row.account_number)}`,
      destination: {
        bankName: row.bank_name ?? null,
        accountNumber: maskTail(row.account_number),
        accountHolderName: row.account_holder_name ?? row.name ?? null,
        upiId: row.upi_id ?? null,
      },
      date: row.date,
    }),
  },
  {
    method: 'apay',
    type: 'Fiat',
    model: 'Apaywithdrawals',
    userColumn: 'user_id',
    userIdIsText: true,
    dateColumn: 'created_at',
    orderColumn: 'id',
    currencyColumn: 'currency',
    /**
     * The account fields live inside `payout_details`, whose shape varies per
     * payment system (imps / bkash / pkr_w / esewa). Legacy flattened it the
     * same way, and had to `JSON.parse` it defensively because the column is
     * JSONB in the baseline but was written as a string by an earlier build.
     */
    present: (row) => {
      const d = parseJson(row.payout_details);
      return {
        id: row.id,
        reference: row.custom_transaction_id ?? row.order_id ?? null,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        details: `${row.payment_system ?? 'Payout'}: ${d.account_number ?? d.upi_id ?? 'N/A'}`,
        destination: {
          bankName: d.bank_name ?? row.payment_system ?? null,
          accountNumber: d.account_number ?? null,
          accountHolderName: d.account_name ?? null,
          ifscCode: d.bank_code ?? null,
          upiId: d.upi_id ?? null,
        },
        errorReason: row.error_reason ?? null,
        date: row.created_at,
      };
    },
  },
  {
    method: 'f2pay',
    type: 'Fiat',
    model: 'F2payWithdrawals',
    userColumn: 'user_id',
    userIdIsText: false,
    dateColumn: 'created_at',
    orderColumn: 'id',
    currencyColumn: 'currency',
    present: (row) => ({
      id: row.id,
      reference: row.mch_order_no,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      details: `Bank: ${row.ifsc ?? 'N/A'}, Acc: ${maskTail(row.account_number)}`,
      destination: {
        accountNumber: maskTail(row.account_number),
        accountHolderName: row.account_holder_name ?? null,
        ifscCode: row.ifsc ?? null,
      },
      errorReason: row.error_reason ?? null,
      date: row.created_at,
    }),
  },
]);

function parseJson(value) {
  if (!value) return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) ?? {};
  } catch {
    return {};
  }
}

module.exports = { DEPOSIT_SOURCES, WITHDRAWAL_SOURCES, NUMERIC_STATUS, normaliseStatus };

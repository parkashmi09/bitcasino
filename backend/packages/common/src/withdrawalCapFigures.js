'use strict';

// Shared (2026-10-16): user-service ka withdraw cap aur admin ka Users → Financial dono yahi figures padhte hain.
// Pehle services/user/src/modules/withdraw-requirements/withdrawCap.js me tha; wo file ab yahin se export karti hai.
const capRule = require('./withdrawalCap');
const money = require('./money');

const QueryTypes = Object.freeze({ SELECT: 'SELECT' });

/**
 * The deposit cap's three figures for one player in one currency — deposited, withdrawn,
 * wagered — read from the rails' own tables, in that currency (never converted: see
 * packages/common/src/withdrawalCap.js for the rule and why).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * DEPOSITED  money that reached the wallet
 *   fiat_deposits        status 'approved'                    currency
 *   apaydeposits         'Success'                            currency
 *   cricpaytransactions  'Successful'                         always INR
 *   upideposit           'success'                            always INR (uid, amount are text)
 *   pay_in_transactions  status 1 (WayPay)                    currency
 *   ccdeposit            'Success' (CCPayment crypto)         coinid → coin; `price`
 *   f2paydeposits        'Success' (F2Pay)                    currency
 *   staff_transfers      to_type 'user', a player-funding type  always INR (no currency column)
 *     (transfer / refill / issuance / adjust; the gt / casino settlement rows are not funding)
 *   NOT owner_direct_ledger: the Super Admin's Direct User Wallet credit (and debit) is the
 *     operator's own adjustment, neither a deposit nor a withdrawal — so it sets no rollover and
 *     no cap (user, 2026-10-19, replacing the 2026-10-17 rule that counted it). Its 'direct'
 *     staff_transfers twin is not in the funding list either.
 *
 * WITHDRAWN  money that left, or is held to leave: pending and paid count (else a player could
 *            queue several requests past the cap); rejected / failed-and-refunded do not.
 *   fiat_withdrawals     not 'Rejected'                       currency
 *   withdrawals (crypto) not 'Rejected'                       coin
 *   apaywithdrawals      not refunded, not rejected/declined/cancelled
 *                        ('Failed' with refunded = false still holds the player's money)
 *   f2paywithdrawals     as apaywithdrawals (F2Pay payouts)
 *   pay_out_transactions status 0 (pending) or 1 (paid); 2 = failed and refunded
 *   staff_transfers      from_type 'user', a player-funding type (an agent collecting), INR
 *   owner_direct_ledger  entry_type 'user_withdraw' (Super Admin took it back), as above
 *
 * Each rail writes exactly one table (gateway settlements never write fiat_deposits, gateway
 * payouts never fiat_withdrawals), so nothing is counted twice. `deposits` and `inr_deposit`
 * are legacy (never written / never credit a wallet) and are left out.
 *
 * ═════════════════════════════════════════════════════════════════════════
 */

/** CCPayment's numeric coin ids (services/admin/src/modules/dashboard/dashboard.constants.js). */
const CCPAYMENT_COINS = Object.freeze({
  1155: 'BTC', 1161: 'ETH', 1173: 'LTC', 1169: 'BCH', 1280: 'USDT', 1482: 'TRX',
  1492: 'DOGE', 1375: 'ADA', 1331: 'XRP', 1168: 'BNB', 1282: 'USDC', 1864: 'SHIB',
});
const CC_CASE = `CASE coinid ${Object.entries(CCPAYMENT_COINS).map(([id, c]) => `WHEN ${Number(id)} THEN '${c}'`).join(' ')} END`;

const FUNDING = `('transfer','refill','issuance','adjust')`;
const NOT_OUT = `('rejected','declined','cancelled','canceled')`;

const DEPOSITED_SQL = `
  SELECT
      (SELECT COALESCE(SUM(amount), 0) FROM fiat_deposits
        WHERE user_id = :uid AND upper(currency) = :cur AND lower(status) = 'approved')
    + (SELECT COALESCE(SUM(amount), 0) FROM apaydeposits
        WHERE user_id = :uid AND upper(currency) = :cur AND lower(status) = 'success')
    + (SELECT COALESCE(SUM(amount), 0) FROM cricpaytransactions
        WHERE :cur = 'INR' AND uid = :uid AND lower(status) = 'successful')
    + (SELECT COALESCE(SUM(CASE WHEN amount ~ '^[0-9]+(\\.[0-9]+)?$' THEN amount::numeric ELSE 0 END), 0) FROM upideposit
        WHERE :cur = 'INR' AND uid = :uidText AND lower(status) = 'success')
    + (SELECT COALESCE(SUM(amount), 0) FROM pay_in_transactions
        WHERE user_id = :uid AND upper(currency) = :cur AND status = 1)
    + (SELECT COALESCE(SUM(price), 0) FROM ccdeposit
        WHERE userid = :uidText AND ${CC_CASE} = :cur AND lower(status) = 'success')
    + (SELECT COALESCE(SUM(amount), 0) FROM f2paydeposits
        WHERE user_id = :uid AND upper(currency) = :cur AND lower(status) = 'success')
    + (SELECT COALESCE(SUM(amount), 0) FROM staff_transfers
        WHERE :cur = 'INR' AND to_type = 'user' AND to_id = :uid AND transfer_type IN ${FUNDING})
    AS total`;

const WITHDRAWN_SQL = `
  SELECT
      (SELECT COALESCE(SUM(amount), 0) FROM fiat_withdrawals
        WHERE uid = :uid AND upper(currency) = :cur AND lower(status) NOT IN ${NOT_OUT})
    + (SELECT COALESCE(SUM(amount), 0) FROM withdrawals
        WHERE uid = :uid AND upper(coin) = :cur AND lower(status) NOT IN ${NOT_OUT})
    + (SELECT COALESCE(SUM(amount), 0) FROM apaywithdrawals
        WHERE user_id = :uidText AND upper(currency) = :cur
          AND refunded IS NOT TRUE AND lower(status) NOT IN ${NOT_OUT})
    + (SELECT COALESCE(SUM(amount), 0) FROM pay_out_transactions
        WHERE user_id = :uid AND upper(currency) = :cur AND status IN (0, 1))
    + (SELECT COALESCE(SUM(amount), 0) FROM f2paywithdrawals
        WHERE user_id = :uid AND upper(currency) = :cur
          AND refunded IS NOT TRUE AND lower(status) NOT IN ${NOT_OUT})
    + (SELECT COALESCE(SUM(amount), 0) FROM staff_transfers
        WHERE :cur = 'INR' AND from_type = 'user' AND from_id = :uid AND transfer_type IN ${FUNDING})
    AS total`;

/**
 * WAGERED  what the player has bet, net of refunds / rollbacks / voids, per wallet currency.
 *   bets (in-house)          amount; a refunded round (`result` = "refunded") and QA rows
 *                            (`result.fake`) are not turnover; coin = the wallet column
 *   gis_transactions         bet = |amount|; a refund takes back at most its bet's stake; a
 *                            rollback of a bet takes the stake back, of a refund re-adds it.
 *                            Stored currency is the wallet's; legacy labels PKR → INR, USD → USDT
 *   seamless_transactions    withdraw / pushbet = stake; rollback / cancel of one undoes it. USDT
 *   js_game_transactions     v1: additional_data.bet_amount on settle / bet / win / loss rows,
 *                            superseded duplicates excluded (no refund path exists)
 *   game_transactions        v2: additional_data.bet_amount (a provider correction arrives as a
 *                            negative bet_amount and nets out)
 *   transactionscasino       x-casino: BET rows still 'OK' (a cancel flips the bet to CANCELLED),
 *                            in the wallet column actually moved
 *   aggregator_transactions  stake. USDT
 *   og_transactions          original games: bet amount, less an applied rollback of that bet
 *   "SportsBet"              settled (closed, won / loss) only — void and refund are not
 *                            turnover — at the money really at risk: LEAST(stake, liability),
 *                            which is the stake for a back bet and the liability for a cheap lay.
 *                            The book only moves INR.
 * `wager_activity` is NOT used: it is best-effort (a failed internal call or a coin without a USD
 * rate counts nothing) and counts sports at the full stake.
 */
const AMOUNT_RE = `'^-?[0-9]+(\\.[0-9]+)?$'`;
const betAmount = (col) => `CASE WHEN (${col}->>'bet_amount') ~ ${AMOUNT_RE} THEN (${col}->>'bet_amount')::numeric ELSE 0 END`;
const WAGERED_SQL = `
  SELECT
      (SELECT COALESCE(SUM(amount), 0) FROM bets
        WHERE uid = :uid AND upper(coin) = :cur AND amount > 0
          AND (result IS NULL OR result::text <> '"refunded"')
          AND (result::jsonb ->> 'fake') IS DISTINCT FROM 'true')
    + (SELECT COALESCE(SUM(
          CASE lower(g.action)
            WHEN 'bet' THEN ABS(g.amount)
            WHEN 'refund' THEN -LEAST(ABS(g.amount), COALESCE(ABS(b.amount), ABS(g.amount)))
            WHEN 'rollback' THEN CASE lower(o.action) WHEN 'bet' THEN -ABS(g.amount) WHEN 'refund' THEN ABS(g.amount) ELSE 0 END
            ELSE 0 END), 0)
         FROM gis_transactions g
         LEFT JOIN gis_transactions b ON lower(g.action) = 'refund' AND b.transaction_id = g.bet_transaction_id AND lower(b.action) = 'bet'
         LEFT JOIN gis_transactions o ON lower(g.action) = 'rollback' AND o.transaction_id = g.bet_transaction_id
        WHERE g.user_id = :uid AND lower(g.action) IN ('bet','refund','rollback')
          AND (CASE upper(g.currency) WHEN 'PKR' THEN 'INR' WHEN 'USD' THEN 'USDT' ELSE upper(g.currency) END) = :cur)
    + (SELECT COALESCE(SUM(
          CASE WHEN s.action IN ('withdraw','pushbet') THEN ABS(s.amount)
               WHEN s.action IN ('rollback','cancel') AND o.action IN ('withdraw','pushbet') THEN -ABS(s.amount)
               ELSE 0 END), 0)
         FROM seamless_transactions s
         LEFT JOIN seamless_transactions o ON o.transaction_id = s.reverses_id
        WHERE :cur = 'USDT' AND s.user_id = :uid AND s.action IN ('withdraw','pushbet','rollback','cancel'))
    + (SELECT COALESCE(SUM(${betAmount('additional_data')}), 0) FROM js_game_transactions
        WHERE user_id = :uid AND upper(currency) = :cur AND superseded IS NOT TRUE
          AND transaction_type IN ('bet','settle','win','loss'))
    + (SELECT COALESCE(SUM(${betAmount('additional_data')}), 0) FROM game_transactions
        WHERE user_id = :uid AND upper(currency) = :cur)
    + (SELECT COALESCE(SUM(amount), 0) FROM transactionscasino
        WHERE user_id = :uid AND upper(wallet) = :cur AND transaction_type = 'BET' AND transaction_status = 'OK')
    + (SELECT COALESCE(SUM(stake), 0) FROM aggregator_transactions
        WHERE :cur = 'USDT' AND user_id = :uid AND stake > 0)
    + (SELECT COALESCE(SUM(CASE WHEN t.kind = 'bet' THEN t.amount
                                WHEN t.kind = 'rollback' AND o.kind = 'bet' THEN -t.amount ELSE 0 END), 0)
         FROM og_transactions t
         LEFT JOIN og_transactions o ON t.kind = 'rollback' AND o.transaction_id = t.reference_transaction_id
        WHERE t.user_id = :uid AND t.currency = :cur AND t.status = 'applied')
    + (SELECT COALESCE(SUM(LEAST(stake_amount, COALESCE(NULLIF(liability, 0), stake_amount))), 0) FROM mssports."SportsBet"
        WHERE :cur = 'INR' AND user_id = :uid AND lower(status) = 'closed'
          AND lower(COALESCE(result_status, '')) IN ('won','loss') AND stake_amount > 0)
    AS total`;

/** The currencies this player has ever moved money in, on any rail (for the no-currency read). */
const CURRENCIES_SQL = `
  SELECT DISTINCT cur FROM (
    SELECT upper(currency) AS cur FROM fiat_deposits WHERE user_id = :uid AND lower(status) = 'approved'
    UNION SELECT upper(currency) FROM apaydeposits WHERE user_id = :uid AND lower(status) = 'success'
    UNION SELECT 'INR' FROM cricpaytransactions WHERE uid = :uid AND lower(status) = 'successful'
    UNION SELECT 'INR' FROM upideposit WHERE uid = :uidText AND lower(status) = 'success'
    UNION SELECT upper(currency) FROM pay_in_transactions WHERE user_id = :uid AND status = 1
    UNION SELECT ${CC_CASE} FROM ccdeposit WHERE userid = :uidText AND lower(status) = 'success'
    UNION SELECT upper(currency) FROM f2paydeposits WHERE user_id = :uid AND lower(status) = 'success'
    UNION SELECT 'INR' FROM staff_transfers WHERE to_type = 'user' AND to_id = :uid AND transfer_type IN ${FUNDING}
    UNION SELECT upper(currency) FROM fiat_withdrawals WHERE uid = :uid AND lower(status) NOT IN ${NOT_OUT}
    UNION SELECT upper(coin) FROM withdrawals WHERE uid = :uid AND lower(status) NOT IN ${NOT_OUT}
    UNION SELECT upper(currency) FROM apaywithdrawals WHERE user_id = :uidText AND refunded IS NOT TRUE AND lower(status) NOT IN ${NOT_OUT}
    UNION SELECT upper(currency) FROM pay_out_transactions WHERE user_id = :uid AND status IN (0, 1)
    UNION SELECT upper(currency) FROM f2paywithdrawals WHERE user_id = :uid AND refunded IS NOT TRUE AND lower(status) NOT IN ${NOT_OUT}
  ) c WHERE cur IS NOT NULL ORDER BY cur`;

function createCapFigures({ db }) {
  async function one(sql, replacements, transaction) {
    const [row] = await db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
    return money.toDecimalString(money.toMinorQuantised(String(row?.total ?? '0')));
  }

  /** `{ deposited, withdrawn, wagered }` as decimal strings in `currency`. Throws on a DB error. */
  async function figures(userId, currency, { transaction, wagered: needWagered = true } = {}) {
    const replacements = { uid: String(userId), uidText: String(userId), cur: String(currency).toUpperCase() };
    const [deposited, withdrawn, wagered] = await Promise.all([
      one(DEPOSITED_SQL, replacements, transaction),
      one(WITHDRAWN_SQL, replacements, transaction),
      needWagered ? one(WAGERED_SQL, replacements, transaction) : '0.00000000',
    ]);
    return { deposited, withdrawn, wagered };
  }

  /** Every currency the player has deposited or withdrawn in, sorted. */
  async function currencies(userId, { transaction } = {}) {
    const rows = await db.sequelize.query(CURRENCIES_SQL, {
      replacements: { uid: String(userId), uidText: String(userId) },
      type: QueryTypes.SELECT,
      transaction,
    });
    return rows.map((r) => r.cur);
  }

  return { figures, currencies, compute: capRule.computeCap };
}

module.exports = { createCapFigures, CCPAYMENT_COINS };

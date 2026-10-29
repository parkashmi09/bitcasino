'use strict';

const { money } = require('@ibitplay/common');

/** The stakes and their reversals in `credits_ledger` that wager and loss are measured on. */
const BET_REASONS = Object.freeze(['BET_STAKE', 'BET_PAYOUT', 'BET_REFUND', 'BET_ROLLBACK']);

/** `money`'s arithmetic answers BigInt minor units; this turns one back into a decimal string. */
const dec = (minor) => money.toDecimalString(minor);

/**
 * rainbet: what players staked and lost in a window, in USD at today's rates — the reading the
 * responsible-gambling limits and the raffle's tickets share. Stakes are negative `BET_STAKE`
 * rows, payouts / refunds / rollbacks positive. Wagered = stakes less what was refunded or rolled
 * back; lost = the net outflow (never below zero). A coin with no rate is left out.
 *
 * `rows` are `{ currency, reason, amount }` sums; `toUsd` is `rewardMoney.toUsd`.
 */
async function summarise(rows, toUsd) {
  let staked = '0';
  let returned = '0';
  let net = '0';
  for (const row of rows) {
    const usd = await toUsd(dec(money.abs(String(row.amount))), row.currency);
    if (usd == null) continue;
    net = dec(money.add(net, money.isNegative(String(row.amount)) ? dec(money.negate(usd)) : usd));
    if (row.reason === 'BET_STAKE') staked = dec(money.add(staked, usd));
    if (row.reason === 'BET_REFUND' || row.reason === 'BET_ROLLBACK') returned = dec(money.add(returned, usd));
  }
  return {
    wagered: dec(money.max(dec(money.subtract(staked, returned)), '0')),
    lost: dec(money.max(dec(money.negate(net)), '0')),
  };
}

const window = (until) => (until ? 'AND created_at >= :since AND created_at < :until' : 'AND created_at >= :since');

/** One player's `{ wagered, lost }` since `since` (and before `until`, when given). */
async function betUsage({ db, toUsd }, { userId, since, until = null }) {
  const rows = await db.sequelize.query(
    `SELECT currency, reason, COALESCE(SUM(amount), 0)::text AS amount
       FROM credits_ledger
      WHERE user_id = :uid ${window(until)} AND reason IN (:reasons)
      GROUP BY currency, reason`,
    { replacements: { uid: String(userId), since, until, reasons: BET_REASONS }, type: db.sequelize.QueryTypes.SELECT }
  );
  return summarise(rows, toUsd);
}

/** Every player who bet in `[since, until)`: `Map<userId, wageredUsd>`. */
async function wageredByPlayer({ db, toUsd }, { since, until }) {
  const rows = await db.sequelize.query(
    `SELECT user_id, currency, reason, COALESCE(SUM(amount), 0)::text AS amount
       FROM credits_ledger
      WHERE reason IN (:reasons) ${window(until)}
      GROUP BY user_id, currency, reason`,
    { replacements: { since, until, reasons: BET_REASONS }, type: db.sequelize.QueryTypes.SELECT }
  );
  const byPlayer = new Map();
  for (const row of rows) {
    const id = String(row.user_id);
    if (!byPlayer.has(id)) byPlayer.set(id, []);
    byPlayer.get(id).push(row);
  }
  const out = new Map();
  for (const [id, list] of byPlayer) out.set(id, (await summarise(list, toUsd)).wagered);
  return out;
}

module.exports = { betUsage, wageredByPlayer, BET_REASONS };

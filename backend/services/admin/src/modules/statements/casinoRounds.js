'use strict';

/**
 * Casino rounds outside Slotegrator, one row per round/callback, for the
 * per-player admin views (player Stats, statement, statement bets, Risk).
 *
 *   inhouse    `bets` — one row IS a round. `amount` is the stake, `profit` the
 *              net the engine actually paid (payout − stake). `result` NULL is an
 *              open round (stake taken, nothing back yet); `"refunded"` is a
 *              round that never happened and is left out entirely. Bot/QA rounds
 *              (`result.fake`) are not play.
 *   jsgamesv2  `game_transactions` — one row per provider callback, `amount` =
 *              win − bet (signed). The stake is the callback's `bet_amount` and
 *              the payout its `win_amount` (both kept in `additional_data`); a
 *              row without them falls back to the sign of `amount`. A negative
 *              `bet_amount` is the provider reversing a stake and nets it off.
 *   og         `og_transactions` (Original Games) — a `bet` leg and a `win` leg per round,
 *              both unsigned, paired on `round_id`. One row per applied bet a rollback did
 *              not undo; the payout is the round's win legs (none yet = open).
 *   seamless   `seamless_transactions` — `amount` signed in the settlement coin
 *              (USDT). A stake is `withdraw`/`pushbet` (negative); a payout is
 *              `deposit`; `rollback`/`cancel` reverse one of those, so a credit
 *              there nets a stake off and a debit nets a payout off; `transfer`
 *              is signed either way.
 *
 * Every row carries `stake`, `payout`, `net` (= payout − stake, what the wallet
 * moved) and `n` (1 for a row that opened a round, else 0), so the callers sum
 * the same figures. Slotegrator keeps its own path (`statements.constants.js`
 * `gis*`) because the statement already reads it that way.
 *
 * `idsSql` / `rangeSql` are fixed column predicates built here; every value is a
 * replacement (`:ids`, `:roundsFrom`, `:roundsTo`).
 */

const NUMERIC = "'^-?[0-9]+(\\.[0-9]+)?$'";

/** A JSON text field as numeric, NULL when it is absent or not a plain number. */
const jsonNum = (alias, key) =>
  `(CASE WHEN ${alias}.additional_data->>'${key}' ~ ${NUMERIC} THEN (${alias}.additional_data->>'${key}')::numeric END)`;

const V2_STAKE = (a) => `COALESCE(${jsonNum(a, 'bet_amount')}, GREATEST(-${a}.amount, 0))`;
const V2_PAYOUT = (a) => `COALESCE(${jsonNum(a, 'win_amount')}, GREATEST(${a}.amount, 0))`;

/** In-house: an open round has paid nothing; a settled one paid stake + profit (never below 0). */
const INHOUSE_PAYOUT = (a) => `(CASE WHEN ${a}.result IS NULL THEN 0 ELSE GREATEST(${a}.amount + ${a}.profit, 0) END)`;
const INHOUSE_STATUS = (a) =>
  `(CASE WHEN ${a}.result IS NULL THEN 'open'
         WHEN ${a}.profit > 0 THEN 'won'
         WHEN ${a}.profit = 0 THEN 'push'
         ELSE 'lost' END)`;
const INHOUSE_PLAYED = (a) =>
  `(${a}.result IS NULL OR ${a}.result::text <> '"refunded"') AND (${a}.result->>'fake') IS DISTINCT FROM 'true'`;

/**
 * Original Games (`og_transactions`): a `bet` and a `win` leg per round, both unsigned. A leg a
 * rollback undid is a refund — neither turnover nor payout (admin original-games service's rule).
 */
const OG_ROLLED_BACK = (a) =>
  `EXISTS (SELECT 1 FROM og_transactions ogr
            WHERE ogr.kind = 'rollback' AND ogr.status = 'applied' AND ogr.reference_transaction_id = ${a}.transaction_id)`;
const OG_PLAYED = (a) => `${a}.kind IN ('bet', 'win') AND ${a}.status = 'applied' AND NOT ${OG_ROLLED_BACK(a)}`;

/** An Original Games round's payout: its applied win legs; NULL while no win leg has landed. */
const OG_PAYOUT = (a) =>
  `(SELECT SUM(w.amount) FROM og_transactions w
     WHERE w.kind = 'win' AND w.status = 'applied' AND w.round_id = ${a}.round_id AND w.user_id = ${a}.user_id
       AND NOT ${OG_ROLLED_BACK('w')})`;

const SEAMLESS_STAKE = (a) =>
  `(CASE WHEN LOWER(${a}.action) IN ('withdraw', 'pushbet', 'transfer') AND ${a}.amount < 0 THEN -${a}.amount
         WHEN LOWER(${a}.action) IN ('rollback', 'cancel') AND ${a}.amount > 0 THEN -${a}.amount
         ELSE 0 END)`;
const SEAMLESS_PAYOUT = (a) =>
  `(CASE WHEN LOWER(${a}.action) IN ('deposit', 'transfer') AND ${a}.amount > 0 THEN ${a}.amount
         WHEN LOWER(${a}.action) IN ('rollback', 'cancel') AND ${a}.amount < 0 THEN ${a}.amount
         ELSE 0 END)`;

/**
 * The union, as a subquery body with columns
 * `(source, id, user_id, ts, game, currency, stake, payout, net, n, status)`.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.range]  filter on `:roundsFrom` (inclusive) / `:roundsTo` (exclusive)
 * @param {boolean} [opts.seamless=true]
 */
function casinoRoundsSql({ range = false, seamless = true } = {}) {
  const when = (column) => (range ? ` AND ${column} >= :roundsFrom AND ${column} < :roundsTo` : '');
  const parts = [
    `SELECT 'inhouse' AS source, b.id::text AS id, b.uid::bigint AS user_id, b.created AS ts,
            b.game::text AS game, UPPER(b.coin) AS currency,
            b.amount AS stake, ${INHOUSE_PAYOUT('b')} AS payout,
            ${INHOUSE_PAYOUT('b')} - b.amount AS net, 1 AS n, ${INHOUSE_STATUS('b')} AS status
       FROM bets b
      WHERE b.uid IN (:ids) AND b.amount > 0 AND ${INHOUSE_PLAYED('b')}${when('b.created')}`,
    `SELECT 'jsgamesv2', v.id::text, v.user_id::bigint, v.created_at,
            COALESCE(NULLIF(v.game_name, ''), v.game_uid)::text, UPPER(v.currency),
            ${V2_STAKE('v')}, ${V2_PAYOUT('v')}, v.amount,
            CASE WHEN ${V2_STAKE('v')} > 0 THEN 1 ELSE 0 END,
            LOWER(v.transaction_type)::text
       FROM game_transactions v
      WHERE v.user_id IN (:ids) AND LOWER(COALESCE(v.transaction_status, 'completed')) = 'completed'${when('v.created_at')}`,
    `SELECT 'og', o.id::text, o.user_id::bigint, o.created_at,
            COALESCE(og.name, o.game_code, 'Original Games')::text, UPPER(o.currency),
            o.amount, COALESCE(o.payout, 0), COALESCE(o.payout, 0) - o.amount, 1,
            CASE WHEN o.payout IS NULL THEN 'open' WHEN o.payout > o.amount THEN 'won'
                 WHEN o.payout = o.amount THEN 'push' ELSE 'lost' END
       FROM (SELECT b.*, ${OG_PAYOUT('b')} AS payout FROM og_transactions b
              WHERE b.user_id IN (:ids) AND b.kind = 'bet' AND ${OG_PLAYED('b')}${when('b.created_at')}) o
       LEFT JOIN og_games og ON og.code = o.game_code`,
  ];
  if (seamless) {
    parts.push(
      `SELECT 'seamless', s.id::text, s.user_id::bigint, s.created_at,
              COALESCE(NULLIF(s.game_code, ''), s.product_code, 'Casino')::text, 'USDT',
              ${SEAMLESS_STAKE('s')}, ${SEAMLESS_PAYOUT('s')}, s.amount,
              CASE WHEN LOWER(s.action) IN ('withdraw', 'pushbet') AND s.amount < 0 THEN 1 ELSE 0 END,
              LOWER(s.action)::text
         FROM seamless_transactions s
        WHERE s.user_id IN (:ids) AND s.amount <> 0${when('s.created_at')}`
    );
  }
  return parts.join('\n      UNION ALL\n      ');
}

/**
 * In-house rounds with NO wallet-ledger stake row.
 *
 * The in-house engine now writes `credits_ledger` rows (BET_STAKE / BET_PAYOUT /
 * BET_REFUND, `meta.refType = 'INHOUSE'`, `meta.refId = <bets.id>`); rounds
 * played before that have none. A ledger-based view (player Stats, the
 * listing's bet count) adds these so history is not lost, without counting a
 * round twice once its ledger rows exist.
 */
const INHOUSE_UNLEDGERED = (a) =>
  `${INHOUSE_PLAYED(a)} AND ${a}.amount > 0
   AND NOT EXISTS (
     SELECT 1 FROM credits_ledger il
      WHERE il.user_id = ${a}.uid::text AND il.reason = 'BET_STAKE'
        AND UPPER(COALESCE(il.meta->>'refType', '')) = 'INHOUSE'
        AND il.meta->>'refId' = ${a}.id::text)`;

/** `from`/`to` as the statement takes them (bare YYYY-MM-DD, `to` inclusive) → [start, end). */
function dayRange(from, to) {
  return {
    roundsFrom: from ? new Date(`${from}T00:00:00.000Z`) : new Date('1970-01-01T00:00:00.000Z'),
    roundsTo: to ? new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) : new Date('9999-01-01T00:00:00.000Z'),
  };
}

module.exports = {
  casinoRoundsSql,
  dayRange,
  INHOUSE_PAYOUT,
  INHOUSE_PLAYED,
  INHOUSE_STATUS,
  INHOUSE_UNLEDGERED,
  OG_ROLLED_BACK,
  OG_PLAYED,
  V2_STAKE,
  V2_PAYOUT,
};

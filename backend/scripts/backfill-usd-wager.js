#!/usr/bin/env node
'use strict';

/**
 * Recompute `userwager` in USD from the bet tables.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY
 *
 * Before migration 071 casino-service added each raw stake, in the bet's own
 * currency, to `userwager.wager` — so on an INR site the total is rupees,
 * while the VIP ladder, bonus gates and affiliate thresholds read it as USD.
 * Since 071 every stake is converted and recorded once in `wager_activity`
 * (`source`, `ref`). This script back-fills `wager_activity` for the stakes
 * settled BEFORE 071, using the same keys the live pipeline uses, then sets
 * each affected player's `userwager` to the USD sum of their activity.
 *
 * Sources (same `(source, ref)` as the live paths, so nothing counts twice):
 *
 *   inhouse      bets                    ref = bets.id, stake = amount, coin; not result "refunded"
 *   gis          gis_transactions        ref = transaction_id, action = 'bet', stake = -amount;
 *                                        not refunded (rf:<id>) or rolled back (rb:<id>)
 *   jsgames-v2   game_transactions       ref = external_transaction_id, staked types,
 *                                        stake = additional_data.bet_amount
 *   xcasino      transactionscasino      ref = transaction_id, type BET, status OK (not CANCELLED),
 *                                        coin = currency_code
 *   seamless     seamless_transactions   ref = transaction_id, withdraw/pushbet, stake = -amount,
 *                                        USDT; not reversed (a row with reverses_id = it)
 *   agg-<name>   aggregator_transactions ref = transaction_id, stake > 0, currency (USDT)
 *   sports       "SportsBet"             ref = id, closed won/loss, stake_amount in INR
 *                                        (the book only debits credits.inr)
 *
 * Refunds/rollbacks that happened AFTER a stake was already counted live
 * (before `/wager/reverse` existed) are stamped `reversed_at` here, so the
 * recomputed total leaves them out. Their rakeback accrual is NOT reversed by
 * this script (it may already be claimed).
 *
 * NOT recoverable: js-games v1 (its rows store the signed delta, not the
 * stake, and the provider is unconfigured — no rows exist), x-casino REFUND
 * callbacks (they name no bet), and any legacy wager imported without bets
 * behind it. Players whose `userwager` has no activity behind it are LEFT AS
 * THEY ARE unless `--zero-unbacked` is passed.
 *
 * Rates: TODAY's `exchangerate` (historic rates are not stored). A stake in a
 * currency with no rate is skipped and listed.
 *
 * Side effects NOT replayed: VIP level/rank-up credits, rakeback and affiliate
 * commission already paid stay paid; a total that goes DOWN claws nothing back
 * and simply means the player re-earns those bands before the next credit.
 *
 * Idempotent: re-running inserts nothing new (ON CONFLICT DO NOTHING) and
 * writes a `userwager_history` row only for a total that changes.
 *
 *   node scripts/backfill-usd-wager.js                 dry run (rolled back)
 *   node scripts/backfill-usd-wager.js --apply         write
 *   node scripts/backfill-usd-wager.js --apply --zero-unbacked
 * ═════════════════════════════════════════════════════════════════════════
 */

const path = require('path');

/** `amount` × USD rate of `coinExpr`, joined on the rate table (USD reads as USDT). */
const rateJoin = (coinExpr) => `
  JOIN exchangerate e
    ON upper(e.currency) = CASE upper(${coinExpr}) WHEN 'USD' THEN 'USDT' ELSE upper(${coinExpr}) END
   AND e.usd_rate > 0`;

const INSERTS = [
  `INSERT INTO wager_activity (user_id, source, ref, currency, amount, usd_amount, created_at)
   SELECT b.uid, 'inhouse', b.id::text, upper(b.coin), b.amount, round(b.amount * e.usd_rate, 8), COALESCE(b.created, now())
     FROM bets b ${rateJoin('b.coin')}
    WHERE b.amount > 0 AND b.uid IS NOT NULL
      AND COALESCE(b.result::text, '') NOT IN ('"refunded"', 'refunded')
   ON CONFLICT (source, ref) DO NOTHING`,
  `INSERT INTO wager_activity (user_id, source, ref, currency, amount, usd_amount, created_at)
   SELECT g.user_id, 'gis', g.transaction_id, upper(g.currency), -g.amount, round(-g.amount * e.usd_rate, 8), COALESCE(g.created_at, now())
     FROM gis_transactions g ${rateJoin('g.currency')}
    WHERE g.action = 'bet' AND g.amount < 0
      AND NOT EXISTS (SELECT 1 FROM gis_transactions r WHERE r.transaction_id IN ('rf:' || g.transaction_id, 'rb:' || g.transaction_id))
   ON CONFLICT (source, ref) DO NOTHING`,
  `INSERT INTO wager_activity (user_id, source, ref, currency, amount, usd_amount, created_at)
   SELECT t.user_id, 'jsgames-v2', t.external_transaction_id, upper(t.currency),
          (t.additional_data->>'bet_amount')::numeric,
          round((t.additional_data->>'bet_amount')::numeric * e.usd_rate, 8), COALESCE(t.created_at, now())
     FROM game_transactions t ${rateJoin('t.currency')}
    WHERE t.transaction_type IN ('bet', 'bet_result', 'bet_with_negative_result')
      AND (t.additional_data->>'bet_amount') ~ '^[0-9]+(\\.[0-9]+)?$'
      AND (t.additional_data->>'bet_amount')::numeric > 0
   ON CONFLICT (source, ref) DO NOTHING`,
  `INSERT INTO wager_activity (user_id, source, ref, currency, amount, usd_amount, created_at)
   SELECT x.user_id, 'xcasino', x.transaction_id, upper(x.currency_code), x.amount, round(x.amount * e.usd_rate, 8), COALESCE(x.created_at, now())
     FROM transactionscasino x ${rateJoin('x.currency_code')}
    WHERE x.transaction_type = 'BET' AND x.transaction_status = 'OK' AND x.amount > 0 AND x.user_id IS NOT NULL
   ON CONFLICT (source, ref) DO NOTHING`,
  `INSERT INTO wager_activity (user_id, source, ref, currency, amount, usd_amount, created_at)
   SELECT s.user_id, 'seamless', s.transaction_id, 'USDT', -s.amount, round(-s.amount * e.usd_rate, 8), COALESCE(s.created_at, now())
     FROM seamless_transactions s ${rateJoin("'USDT'")}
    WHERE s.action IN ('withdraw', 'pushbet') AND s.amount < 0 AND s.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM seamless_transactions r WHERE r.reverses_id = s.transaction_id)
   ON CONFLICT (source, ref) DO NOTHING`,
  `INSERT INTO wager_activity (user_id, source, ref, currency, amount, usd_amount, created_at)
   SELECT a.user_id, 'agg-' || a.aggregator, a.transaction_id, upper(a.currency), a.stake, round(a.stake * e.usd_rate, 8), COALESCE(a.created_at, now())
     FROM aggregator_transactions a ${rateJoin('a.currency')}
    WHERE a.stake > 0 AND a.user_id IS NOT NULL
   ON CONFLICT (source, ref) DO NOTHING`,
  `INSERT INTO wager_activity (user_id, source, ref, currency, amount, usd_amount, created_at)
   SELECT s.user_id, 'sports', s.id::text, 'INR', s.stake_amount, round(s.stake_amount * e.usd_rate, 8), COALESCE(s.updated_at, s.created_at, now())
     FROM "SportsBet" s ${rateJoin("'INR'")}
    WHERE s.status = 'closed' AND s.result_status IN ('won', 'loss') AND s.stake_amount > 0
   ON CONFLICT (source, ref) DO NOTHING`,
];

/** Stakes counted live, then refunded / rolled back before `/wager/reverse` existed. */
const REVERSALS = [
  `UPDATE wager_activity w SET reversed_at = now()
     FROM bets b
    WHERE w.source = 'inhouse' AND w.ref = b.id::text AND w.reversed_at IS NULL
      AND COALESCE(b.result::text, '') IN ('"refunded"', 'refunded')`,
  `UPDATE wager_activity w SET reversed_at = now()
    WHERE w.source = 'gis' AND w.reversed_at IS NULL
      AND EXISTS (SELECT 1 FROM gis_transactions r WHERE r.transaction_id IN ('rf:' || w.ref, 'rb:' || w.ref))`,
  `UPDATE wager_activity w SET reversed_at = now()
     FROM transactionscasino x
    WHERE w.source = 'xcasino' AND w.ref = x.transaction_id AND w.reversed_at IS NULL
      AND x.transaction_status = 'CANCELLED'`,
  `UPDATE wager_activity w SET reversed_at = now()
    WHERE w.source = 'seamless' AND w.reversed_at IS NULL
      AND EXISTS (SELECT 1 FROM seamless_transactions r WHERE r.reverses_id = w.ref)`,
];

const UNRATED = `
  SELECT src, currency, count(*)::int AS stakes FROM (
    SELECT 'inhouse' AS src, upper(coin) AS currency FROM bets WHERE amount > 0
    UNION ALL SELECT 'gis', upper(currency) FROM gis_transactions WHERE action = 'bet'
    UNION ALL SELECT 'jsgames-v2', upper(currency) FROM game_transactions
    UNION ALL SELECT 'xcasino', upper(currency_code) FROM transactionscasino WHERE transaction_type = 'BET'
    UNION ALL SELECT 'agg', upper(currency) FROM aggregator_transactions WHERE stake > 0
  ) x
  WHERE NOT EXISTS (
    SELECT 1 FROM exchangerate e
     WHERE upper(e.currency) = CASE x.currency WHEN 'USD' THEN 'USDT' ELSE x.currency END AND e.usd_rate > 0)
  GROUP BY src, currency`;

/**
 * The backfill itself, on an open connection. Everything runs in ONE
 * transaction that is rolled back unless `apply`. Returns the counts.
 */
async function backfill({ sequelize, QueryTypes, apply = false, zeroUnbacked = false, log = console.log }) {
  const stats = { inserted: 0, reversed: 0, changed: 0, unbacked: 0, unrated: [], players: [] };
  const ROLLBACK = new Error('dry run');
  try {
    await sequelize.transaction(async (transaction) => {
      const q = (sql, opts = {}) => sequelize.query(sql, { transaction, ...opts });
      const select = (sql) => q(sql, { type: QueryTypes.SELECT });
      // pg reports an INSERT's count as a bare number, an UPDATE's as { rowCount }.
      const countOf = (meta) => (typeof meta === 'number' ? meta : meta?.rowCount ?? 0);

      for (const sql of INSERTS) stats.inserted += countOf((await q(sql))[1]);
      log(`historic stakes added to wager_activity: ${stats.inserted}`);

      for (const sql of REVERSALS) stats.reversed += countOf((await q(sql))[1]);
      log(`counted stakes later refunded / rolled back, now reversed: ${stats.reversed}`);

      stats.unrated = await select(UNRATED);
      for (const u of stats.unrated) log(`  skipped (no rate): ${u.src} ${u.currency} × ${u.stakes}`);

      const rows = await select(`
        SELECT COALESCE(a.user_id, w.uid) AS uid,
               COALESCE(replace(w.wager, ',', ''), '0') AS old,
               COALESCE(a.usd, 0)::text AS usd,
               a.user_id IS NOT NULL AS backed
          FROM (SELECT user_id, sum(usd_amount) FILTER (WHERE reversed_at IS NULL) AS usd FROM wager_activity GROUP BY user_id) a
          FULL JOIN userwager w ON w.uid = a.user_id`);

      for (const r of rows) {
        if (!r.backed && !zeroUnbacked) {
          stats.unbacked += 1;
          log(`  uid ${r.uid}: ${r.old} — no bets behind it, left as is`);
          continue;
        }
        const next = Number(r.usd).toFixed(8);
        const prev = r.old;
        if (Number(prev) === Number(next)) continue;
        log(`  uid ${r.uid}: ${prev} → ${next} USD`);
        stats.changed += 1;
        stats.players.push({ uid: String(r.uid), from: prev, to: next });
        await q(
          `INSERT INTO userwager (uid, wager) VALUES (:uid, :next)
           ON CONFLICT (uid) DO UPDATE SET wager = EXCLUDED.wager`,
          { replacements: { uid: r.uid, next } }
        );
        await q(
          `INSERT INTO userwager_history (uid, previous_wager, new_wager, updated_at) VALUES (:uid, :prev, :next, now())`,
          { replacements: { uid: r.uid, prev, next } }
        );
      }
      log(`players whose wager changes: ${stats.changed}`);

      if (!apply) throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return stats;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const zeroUnbacked = process.argv.includes('--zero-unbacked');
  const { connect, QueryTypes } = require('@ibitplay/db');
  const { loadEnv, coercers, dbEnvShape, createLogger } = require('@ibitplay/common');

  const logger = createLogger({ name: 'backfill-usd-wager', level: 'warn' });
  const config = loadEnv(
    { ...dbEnvShape, NODE_ENV: coercers.str('development') },
    { serviceDir: path.resolve(__dirname, '..') }
  );
  const db = await connect({ config, logger, domains: ['core', 'extended'] });

  console.log(`database: ${config.DB_NAME}`);
  console.log(`mode:     ${apply ? 'APPLY' : 'dry run (rolled back; pass --apply to write)'}`);
  try {
    await backfill({ sequelize: db.sequelize, QueryTypes, apply, zeroUnbacked });
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = { INSERTS, REVERSALS, backfill };

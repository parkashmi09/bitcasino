'use strict';

const { money } = require('@ibitplay/common');

/**
 * One player's lifetime casino play, for their own profile page.
 *
 * ── WHAT IT RETURNS, AND WHY IN CURRENCIES ──────────────────────────────
 *
 * Per-currency stake totals, the biggest payout per currency, the top games
 * per currency and the first/last stake time. Not USD: casino-service has no
 * authoritative exchange rate (user-service owns `exchangerate`), so the
 * caller converts, the same split as `wager-report` and the race.
 *
 * ── ONE ROUND TRIP ───────────────────────────────────────────────────────
 *
 * The four sources (see `betHistory.constants.js`) are folded into one
 * `movements` CTE of `stake` and `win` rows, filtered by the player first.
 * Every source has an index leading on its player column
 * (`idx_bets_uid_created`, `idx_gis_transactions_user_id`,
 * `idx_js_game_transactions_user`, `idx_game_transactions_user_round`), so the
 * CTE reads one player's rows and nothing else. Postgres materialises a CTE
 * referenced more than once, so the three aggregates below share one scan.
 *
 * ── WHAT COUNTS ─────────────────────────────────────────────────────────
 *
 * Stakes as `wager-report` and the race count them: in-house rows that were
 * not refunded; Slotegrator `bet`; jsGames v1 `bet` (+ `settle`, a bet and win
 * in one row); jsGames v2 `bet` and `loss`. Wins are payout rows worth more
 * than zero (an in-house round's payout is stake + profit). Refunds and
 * rollbacks are neither. A Slotegrator game whose catalogue type says "sport"
 * (the partner sportsbook) is reported under `sports`, everything else under
 * `casino`. Original Games aggregator rounds (`og_transactions`) count as casino too.
 */
const SQL = `
  WITH movements AS (
    -- in-house originals: one row is a round, 'amount' the stake, 'profit' the net win
    SELECT 'stake'::text AS kind, 'casino'::text AS section, UPPER(b.coin) AS currency,
           b.amount AS amount, 'inhouse:' || b.game AS game_key, b.game AS game_name,
           NULL::text AS provider, b.created AS at
      FROM bets b
     WHERE b.uid = :userId AND b.amount > 0
       AND (b.result IS NULL OR b.result::text <> '"refunded"')
    UNION ALL
    SELECT 'win', 'casino', UPPER(b.coin), b.amount + b.profit, 'inhouse:' || b.game, b.game, NULL, b.created
      FROM bets b
     WHERE b.uid = :userId AND b.profit > 0

    UNION ALL
    -- Slotegrator: a bet row and a win row per spin, both unsigned. A win that pays back no more
    -- than its round's stakes is a 'payout' (money back, not a won round); no round_id = a win.
    SELECT CASE WHEN LOWER(g.action) = 'bet' THEN 'stake'
                WHEN g.amount > COALESCE((SELECT SUM(b.amount) FROM gis_transactions b
                                           WHERE b.round_id = g.round_id AND b.user_id = g.user_id
                                             AND LOWER(b.action) = 'bet'), 0) THEN 'win'
                ELSE 'payout' END,
           CASE WHEN LOWER(COALESCE(gg.type, '')) LIKE '%sport%' THEN 'sports' ELSE 'casino' END,
           UPPER(COALESCE(g.currency, '')), g.amount, 'gis:' || COALESCE(g.game_uuid, ''),
           COALESCE(gg.name, g.game_uuid), gg.provider, g.created_at
      FROM gis_transactions g
      LEFT JOIN gis_games gg ON gg.uuid = g.game_uuid
     WHERE g.user_id = :userId AND LOWER(g.action) IN ('bet', 'win') AND g.amount > 0

    UNION ALL
    -- jsGames v1
    SELECT CASE WHEN LOWER(j.transaction_type) = 'win' THEN 'win' ELSE 'stake' END,
           'casino', UPPER(j.currency), ABS(j.amount), 'js:' || COALESCE(j.game_uid, ''),
           COALESCE(jg.game_name, j.game_uid), jg.vendor, j.timestamp
      FROM js_game_transactions j
      LEFT JOIN js_games jg ON jg.game_uid = j.game_uid
     WHERE j.user_id = :userId AND j.amount <> 0
       AND LOWER(j.transaction_type) IN ('bet', 'settle', 'win')
       AND LOWER(j.transaction_status) = 'completed'

    UNION ALL
    -- jsGames v2: a losing spin is its own debit ('loss'), so it is a stake
    SELECT CASE WHEN LOWER(v.transaction_type) = 'win' THEN 'win' ELSE 'stake' END,
           'casino', UPPER(v.currency), ABS(v.amount), 'js:' || COALESCE(v.game_uid, ''),
           COALESCE(jg2.game_name, v.game_uid), jg2.vendor, v.created_at
      FROM game_transactions v
      LEFT JOIN js_games jg2 ON jg2.game_uid = v.game_uid
     WHERE v.user_id = :userId AND v.amount <> 0
       AND LOWER(v.transaction_type) IN ('bet', 'loss', 'win')

    UNION ALL
    -- Original Games aggregator (migration 130): an applied bet not rolled back, and a win > 0.
    -- A win leg that pays back no more than its stake is a 'payout': money back, not a won round.
    SELECT CASE WHEN o.kind = 'bet' THEN 'stake'
                WHEN o.amount > COALESCE((SELECT b.amount FROM og_transactions b
                                           WHERE b.transaction_id = o.reference_transaction_id), 0) THEN 'win'
                ELSE 'payout' END,
           'casino', UPPER(o.currency), o.amount,
           'og:' || COALESCE(o.game_code, ''), COALESCE(og.name, o.game_code), 'BC Originals', o.created_at
      FROM og_transactions o
      LEFT JOIN og_games og ON og.code = o.game_code
     WHERE o.user_id = :userId AND o.status = 'applied' AND o.kind IN ('bet', 'win') AND o.amount > 0
       AND NOT EXISTS (SELECT 1 FROM og_transactions r
                        WHERE r.kind = 'rollback' AND r.status = 'applied' AND r.reference_transaction_id = o.transaction_id)
  )
  SELECT json_build_object(
    'totals', (
      SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT section, currency,
               COALESCE(SUM(amount) FILTER (WHERE kind = 'stake'), 0)::text AS wagered,
               COALESCE(SUM(amount) FILTER (WHERE kind IN ('win', 'payout')), 0)::text AS won,
               COUNT(*) FILTER (WHERE kind = 'stake') AS bets,
               COUNT(*) FILTER (WHERE kind = 'win') AS wins,
               MIN(at) FILTER (WHERE kind = 'stake') AS first_at,
               MAX(at) FILTER (WHERE kind = 'stake') AS last_at
          FROM movements GROUP BY section, currency
      ) t),
    'biggestWins', (
      SELECT COALESCE(json_agg(w), '[]'::json) FROM (
        SELECT DISTINCT ON (currency) currency, amount::text AS amount, game_name AS game, at
          FROM movements WHERE kind = 'win'
         ORDER BY currency, amount DESC, at DESC
      ) w),
    'games', (
      SELECT COALESCE(json_agg(gm), '[]'::json) FROM (
        SELECT game_key, currency, MAX(game_name) AS name, MAX(provider) AS provider,
               SUM(amount)::text AS wagered, COUNT(*) AS bets,
               ROW_NUMBER() OVER (PARTITION BY currency ORDER BY SUM(amount) DESC) AS rank
          FROM movements WHERE kind = 'stake' AND section = 'casino'
         GROUP BY game_key, currency
      ) gm WHERE gm.rank <= :perCurrency),
    -- Best payout multiplier on one round. In-house rows only: a round there is
    -- one row (stake + net profit), where an aggregator spin is a bet row and a
    -- win row that nothing here pairs reliably. Read by the profile medals.
    'maxMultiplier', (
      SELECT ROUND(MAX((b.amount + b.profit) / b.amount), 4)::text
        FROM bets b
       WHERE b.uid = :userId AND b.amount > 0 AND b.profit > 0
         AND (b.result IS NULL OR b.result::text <> '"refunded"'))
  ) AS stats`;

/** How many games per currency come back. The caller ranks across currencies in USD. */
const GAMES_PER_CURRENCY = 10;

// Read side: a SUM of numerics can carry more places than the 8 money keeps.
const dec = (v) => money.toDecimalString(money.toMinorQuantised(String(v ?? '0')));
const iso = (v) => (v ? new Date(v).toISOString() : null);

/**
 * `won` (per row) is the sum of payouts, so `won - wagered` is the net result
 * in that currency. `maxMultiplier` is the best single in-house round's
 * payout / stake, or null before a winning in-house round. Both were added for
 * the profile medals (user-service `medals`), and are additive.
 *
 * @returns {Promise<{
 *   byCurrency: Array<{section, currency, wagered, won, bets, wins, firstAt, lastAt}>,
 *   maxMultiplier: string|null,
 *   biggestWins: Array<{currency, amount, game, at}>,
 *   games: Array<{key, currency, name, provider, wagered, bets}>
 * }>}
 */
async function casinoProfileStats(db, userId) {
  const [row] = await db.sequelize.query(SQL, {
    replacements: { userId, perCurrency: GAMES_PER_CURRENCY },
    type: db.QueryTypes.SELECT,
  });
  const stats = row?.stats ?? {};

  return {
    userId: String(userId),
    byCurrency: (stats.totals ?? []).map((t) => ({
      section: t.section,
      currency: t.currency || 'UNKNOWN',
      wagered: dec(t.wagered),
      won: dec(t.won),
      bets: Number(t.bets ?? 0),
      wins: Number(t.wins ?? 0),
      firstAt: iso(t.first_at),
      lastAt: iso(t.last_at),
    })),
    biggestWins: (stats.biggestWins ?? []).map((w) => ({
      currency: w.currency || 'UNKNOWN',
      amount: dec(w.amount),
      game: w.game ?? null,
      at: iso(w.at),
    })),
    maxMultiplier: stats.maxMultiplier ?? null,
    games: (stats.games ?? []).map((g) => ({
      key: g.game_key,
      currency: g.currency || 'UNKNOWN',
      name: g.name || 'Unknown game',
      provider: g.provider ?? null,
      wagered: dec(g.wagered),
      bets: Number(g.bets ?? 0),
    })),
  };
}

module.exports = { casinoProfileStats, PROFILE_STATS_SQL: SQL, GAMES_PER_CURRENCY };

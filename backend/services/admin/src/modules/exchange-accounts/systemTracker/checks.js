'use strict';

/**
 * System Tracker ke account checks — zip ka `systemTracker/scanner.js` (CORE_CHECKS)
 * aur `hierarchyChecks.js`, hamare schema pe:
 *
 *   zip "Wallets"            →  public.credits   (player = uid, staff/owner = staff_id, wallet_id = credits.id)
 *   zip users / staff        →  public.users (id, name) / public.staff (id, name, parent_id)
 *   zip point_ledger, SportsBet, credits_ledger, user_exposures …  →  schema mssports
 *
 * Har check EK SQL hai jo sirf galat accounts lautata hai:
 *   { user_id, username, role, detail }
 * user_id: player ka id, staff ka 'staff:<id>', bina account wala wallet 'wallet:<id>'.
 *
 * Zip ke jo checks yahan nahi:
 *   plConsistency / exposure (informational) — users.profit / user_net_exposure hamare paas nahi.
 *   cashExceedsBalance — credits me `cash` column nahi (player ka inr hi available hai).
 *   casino wale — is project me table casino nahi.
 */

const BET = 'mssports."SportsBet"';
const LEDGER = 'mssports.credits_ledger';
const EXPOSURE = 'mssports.user_exposures';

/** Players jaise zip ke `users` — naam aur role ke saath. */
const PLAYERS = `(SELECT id, name AS username, 'USER' AS role, parent_staff_id FROM public.users)`;

// Fancy wale game types (user_exposures.game_type / SportsBet.market_type), zip jaise.
const FANCY_GT = `('Normal','Ball By Ball','Over By Over','khado','meter','fancy1','oddeven','fancy2','badlo')`;
const SB_FANCY = `b.game_type = 'FAN'`;
const SB_NOT_FANCY = `COALESCE(b.game_type,'') <> 'FAN'`;
const NOT_BACKLAY = `NOT (team_name ILIKE '%back' OR team_name ILIKE '%lay' OR team_name ILIKE '%totalstake')`;

/**
 * Har wallet + uska account + DIRECT parent ka wallet id.
 * Player ka parent = users.parent_staff_id, staff ka = staff.parent_id (direct user ka koi nahi).
 */
const ACCOUNTS = `
  SELECT c.id AS wallet_id, c.user_type, c.all_point, c.credit, c.upper_point, c.down_point, c.inr,
         COALESCE(u.name, s.name) AS username,
         CASE WHEN c.uid IS NOT NULL THEN CAST(c.uid AS TEXT) ELSE 'staff:' || c.staff_id END AS acct_key,
         CASE WHEN c.uid IS NOT NULL THEN 'USER' ELSE COALESCE(r.name, c.user_type) END AS role,
         CASE WHEN c.uid IS NOT NULL
              THEN (SELECT pc.id FROM public.credits pc WHERE pc.staff_id = u.parent_staff_id LIMIT 1)
              ELSE (SELECT pc.id FROM public.credits pc WHERE pc.staff_id = s.parent_id LIMIT 1) END AS parent_wallet_id
    FROM public.credits c
    LEFT JOIN public.users u ON u.id = c.uid
    LEFT JOIN public.staff s ON s.id = c.staff_id
    LEFT JOIN public.roles r ON r.id = s.role_id
   WHERE c.uid IS NOT NULL OR c.staff_id IS NOT NULL
`;

/** Hierarchy + point ledger — zip `hierarchyChecks.js`. */
const HIERARCHY_CHECKS = [
  {
    // Ledger hi sach hai; all_point uska jod hona chahiye.
    key: 'pointLedgerDrift',
    severity: 'critical',
    label: 'Wallet all_point = SUM(point_ledger deltas)',
    sql: `
      SELECT a.acct_key AS user_id, a.username, a.role,
        'all_point ' || ROUND(COALESCE(a.all_point,0)::numeric,2)
        || ' ≠ ledger SUM ' || ROUND(COALESCE(l.s,0)::numeric,2)
        || ' — drift ' || ROUND((COALESCE(a.all_point,0)-COALESCE(l.s,0))::numeric,2) AS detail
      FROM (${ACCOUNTS}) a
      LEFT JOIN (SELECT wallet_id, SUM(delta) AS s FROM mssports.point_ledger GROUP BY wallet_id) l
             ON l.wallet_id = a.wallet_id
      WHERE ABS(COALESCE(a.all_point,0) - COALESCE(l.s,0)) > 0.01`,
  },
  {
    // Ek settlement ki entry bettor + har upline staff ke wallet me (creditsPoints.mjs ki chain).
    key: 'chainCoverage',
    severity: 'critical',
    label: 'Settlement reaches every wallet in the upline chain',
    sql: `
      WITH RECURSIVE chain AS (
        SELECT u.id AS user_id, CAST(u.parent_staff_id AS BIGINT) AS cur_staff, 1 AS depth FROM public.users u
        UNION ALL
        SELECT c.user_id, s.parent_id, c.depth + 1
          FROM chain c JOIN public.staff s ON s.id = c.cur_staff
         WHERE c.cur_staff IS NOT NULL AND c.depth < 12
      ),
      expected AS (SELECT user_id, MAX(depth) AS n FROM chain GROUP BY user_id),
      actual AS (
        SELECT source_user_id AS user_id, entry_ref, COUNT(DISTINCT wallet_id) AS n
          FROM mssports.point_ledger
         WHERE event_type = 'BET_SETTLEMENT' AND source_user_id IS NOT NULL
         GROUP BY source_user_id, entry_ref
      )
      SELECT CAST(a.user_id AS TEXT) AS user_id, u.username, u.role,
        COUNT(*) || ' settlement(s) wrote ' || a.n
        || ' ledger entr(ies) but the upline chain needs ' || e.n AS detail
      FROM actual a
      JOIN expected e ON e.user_id = a.user_id
      JOIN ${PLAYERS} u ON u.id = a.user_id
      WHERE a.n <> e.n
      GROUP BY a.user_id, u.username, u.role, a.n, e.n`,
  },
  {
    // Parent ka down_point = −Σ(children ka upper_point).
    key: 'settleMirror',
    severity: 'high',
    label: 'Parent down_point mirrors the sum of its children upper_point',
    sql: `
      WITH a AS (${ACCOUNTS})
      SELECT p.acct_key AS user_id, p.username, p.role,
        'down_point ' || ROUND(COALESCE(p.down_point,0)::numeric,2)
        || ' ≠ −Σ(children upper_point) ' || ROUND(COALESCE(-SUM(c.upper_point),0)::numeric,2)
        || ' — drift ' || ROUND((COALESCE(p.down_point,0) - COALESCE(-SUM(c.upper_point),0))::numeric,2) AS detail
      FROM a p LEFT JOIN a c ON c.parent_wallet_id = p.wallet_id
      GROUP BY p.acct_key, p.username, p.role, p.down_point
      HAVING ABS(COALESCE(p.down_point,0) - COALESCE(-SUM(c.upper_point),0)) > 0.01`,
  },
  {
    // Cash settlement (Credit / Debit) hamesha DIRECT parent ke saath.
    key: 'cashSettleCounterparty',
    severity: 'high',
    label: 'Cash settlements are traceable to their direct parent',
    sql: `
      WITH a AS (${ACCOUNTS})
      SELECT a.acct_key AS user_id, a.username, a.role,
        COUNT(*) || ' cash settlement(s) with '
        || CASE WHEN COUNT(*) FILTER (WHERE pl.settled_with_wallet_id IS NULL) = COUNT(*)
                THEN 'no counterparty recorded'
                ELSE 'a counterparty that is not the direct parent' END AS detail
      FROM mssports.point_ledger pl
      JOIN a ON a.wallet_id = pl.wallet_id
      WHERE pl.event_type IN ('Credit','Debit')
        AND pl.settled_with_wallet_id IS DISTINCT FROM a.parent_wallet_id
      GROUP BY a.acct_key, a.username, a.role`,
  },
  {
    key: 'orphanParent',
    severity: 'high',
    label: 'Every account hangs off a live parent',
    sql: `
      SELECT CAST(u.id AS TEXT) AS user_id, u.username, u.role,
             'parent_staff_id ' || u.parent_staff_id || ' does not resolve to a staff account' AS detail
        FROM ${PLAYERS} u
       WHERE u.parent_staff_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = u.parent_staff_id)
      UNION ALL
      SELECT 'staff:' || s.id, s.name, COALESCE(r.name, 'STAFF'),
             'parent_id ' || s.parent_id || ' does not resolve to a staff account'
        FROM public.staff s LEFT JOIN public.roles r ON r.id = s.role_id
       WHERE s.parent_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.staff p WHERE p.id = s.parent_id)
      UNION ALL
      SELECT 'staff:' || s.id, s.name, COALESCE(r.name, 'STAFF'),
             'staff account below the owner has no parent'
        FROM public.staff s JOIN public.roles r ON r.id = s.role_id
       WHERE s.parent_id IS NULL AND r.level > 1`,
  },
  {
    key: 'cyclicParent',
    severity: 'critical',
    label: 'No cycle in any parent chain',
    sql: `
      WITH RECURSIVE walk AS (
        SELECT s.id AS root, s.parent_id AS cur, 1 AS depth, ARRAY[s.id] AS seen, false AS cyc
          FROM public.staff s
        UNION ALL
        SELECT w.root, p.parent_id, w.depth + 1, w.seen || p.id, p.id = ANY(w.seen)
          FROM walk w JOIN public.staff p ON p.id = w.cur
         WHERE NOT w.cyc AND w.depth < 15
      )
      SELECT 'staff:' || w.root AS user_id, s.name AS username, COALESCE(r.name, 'STAFF') AS role,
             'parent chain loops back on itself' AS detail
        FROM (SELECT DISTINCT root FROM walk WHERE cyc) w
        JOIN public.staff s ON s.id = w.root
        LEFT JOIN public.roles r ON r.id = s.role_id`,
  },
  {
    key: 'walletCardinality',
    severity: 'high',
    label: 'Exactly one wallet per live account',
    sql: `
      SELECT CAST(u.id AS TEXT) AS user_id, u.username, u.role,
             COUNT(c.id) || ' wallet rows for this account (expected 1)' AS detail
        FROM ${PLAYERS} u LEFT JOIN public.credits c ON c.uid = u.id
       GROUP BY u.id, u.username, u.role HAVING COUNT(c.id) <> 1
      UNION ALL
      SELECT 'staff:' || s.id, s.name, COALESCE(r.name, 'STAFF'),
             COUNT(c.id) || ' wallet rows for this account (expected 1)'
        FROM public.staff s
        LEFT JOIN public.roles r ON r.id = s.role_id
        LEFT JOIN public.credits c ON c.staff_id = s.id
       WHERE COALESCE(r.level, 0) <> 7
       GROUP BY s.id, s.name, r.name HAVING COUNT(c.id) <> 1`,
  },
  {
    key: 'orphanWallet',
    severity: 'high',
    label: 'No wallet outlives the account behind it',
    sql: `
      SELECT 'wallet:' || c.id AS user_id, NULL AS username, c.user_type AS role,
        'wallet has no account behind it — holds '
        || ROUND(COALESCE(c.inr,0)::numeric,2) || ' inr / '
        || ROUND(COALESCE(c.all_point,0)::numeric,2) || ' points'
        || CASE WHEN ABS(COALESCE(c.inr,0)) <= 0.01 AND ABS(COALESCE(c.all_point,0)) <= 0.01
                THEN ' (empty — cleanup only)' ELSE ' (STILL HOLDS VALUE)' END AS detail
      FROM public.credits c
      WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = c.uid)
        AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = c.staff_id)`,
  },
];

/** Bets / exposure — zip `scanner.js` CORE_CHECKS (sports wale). */
const CORE_CHECKS = [
  {
    key: 'missingSelection',
    severity: 'high',
    label: 'Every bet has a selection',
    sql: `
      SELECT CAST(b.user_id AS TEXT) AS user_id, u.username, u.role, COUNT(*) || ' bet(s) with no selection' AS detail
        FROM ${BET} b JOIN ${PLAYERS} u ON u.id = b.user_id
       WHERE COALESCE(b.selection_name,'') = ''
       GROUP BY b.user_id, u.username, u.role`,
  },
  {
    // Team market (MO/BM): poora group jeeta aur settlement row nahi → unpaid.
    // Fancy: jeeta hua bet bina apni settlement row ke → unpaid.
    key: 'unpaidWin',
    severity: 'high',
    label: 'Winning bets are paid out',
    sql: `
      SELECT x.user_id, u.username, u.role,
        SUM(x.n)::int || ' winning market(s)/bet(s) with no payout recorded' AS detail
      FROM (
        SELECT g.uid AS user_id, g.bets AS n
        FROM (
          SELECT CAST(b.user_id AS TEXT) AS uid, b.match_id, b.market_type,
                 COUNT(*) AS bets,
                 COUNT(*) FILTER (WHERE LOWER(b.result_status)='won') AS won_bets,
                 COUNT(l.id) FILTER (WHERE LOWER(l.reason)='settlement') AS settle_rows
          FROM ${BET} b
          LEFT JOIN ${LEDGER} l ON l.bet_id = b.id AND l.category = 'SPORTS'
          WHERE ${SB_NOT_FANCY} AND LOWER(b.status)='closed'
          GROUP BY 1,2,3
        ) g WHERE g.bets = g.won_bets AND g.settle_rows = 0
        UNION ALL
        SELECT CAST(b.user_id AS TEXT), 1
        FROM ${BET} b
        WHERE ${SB_FANCY} AND LOWER(b.result_status)='won'
          AND NOT EXISTS (SELECT 1 FROM ${LEDGER} l
            WHERE l.category='SPORTS' AND LOWER(l.reason)='settlement' AND l.bet_id = b.id)
      ) x JOIN ${PLAYERS} u ON CAST(u.id AS TEXT) = x.user_id
      GROUP BY x.user_id, u.username, u.role`,
  },
  {
    // Exposure row bina open bet ke = phansa hua paisa.
    key: 'orphanExposure',
    severity: 'high',
    label: 'Blocked exposure has an open bet behind it (no stranded locks)',
    sql: `
      SELECT CAST(e.user_id AS TEXT) AS user_id, u.username, u.role,
        COUNT(*) || ' stranded exposure row(s) holding '
          || ROUND(ABS(SUM(e.exposure_amount))::numeric,2)
          || ' with no open bet (e.g. ' || MIN(e.team_name) || ')' AS detail
      FROM ${EXPOSURE} e
      JOIN ${PLAYERS} u ON u.id = e.user_id
      WHERE COALESCE(e.category,'') <> 'casino'
        AND e.exposure_amount < 0
        AND NOT (e.team_name ILIKE '%back' OR e.team_name ILIKE '%lay' OR e.team_name ILIKE '%totalstake')
        AND NOT EXISTS (
          SELECT 1 FROM ${BET} b
           WHERE b.user_id = e.user_id
             AND b.match_id = e.match_id
             AND b.status = 'open'
             AND (
                   (e.game_type IN ('Normal','Ball By Ball','Over By Over','khado','meter','fancy1','oddeven')
                      AND b.market_type = e.game_type AND b.selection_name = e.team_name)
                OR (e.game_type = 'fancy2' AND b.market_type = e.team_name)
                OR (e.game_type = 'badlo'  AND b.badlo = true)
                OR (e.game_type NOT IN ${FANCY_GT} AND b.market_type = e.game_type)
                 ))
      GROUP BY e.user_id, u.username, u.role`,
  },
  {
    // Ulta: open bet hai par exposure row nahi.
    key: 'unblockedBet',
    severity: 'high',
    label: 'Open bets still hold their exposure row (nothing cleared them early)',
    sql: `
      SELECT CAST(b.user_id AS TEXT) AS user_id, u.username, u.role,
        COUNT(*) || ' open bet(s) staking '
          || ROUND(SUM(b.stake_amount)::numeric,2)
          || ' with no exposure row (e.g. ' || MIN(b.selection_name) || ')' AS detail
      FROM ${BET} b
      JOIN ${PLAYERS} u ON u.id = b.user_id
      WHERE b.status = 'open'
        AND COALESCE(b.badlo,false) = false
        AND b.market_type IN ('Normal','Ball By Ball','Over By Over','khado','meter','fancy1','oddeven')
        AND NOT EXISTS (
          SELECT 1 FROM ${EXPOSURE} e
           WHERE e.user_id = b.user_id
             AND e.match_id = b.match_id
             AND e.game_type = b.market_type
             AND e.team_name = b.selection_name)
      GROUP BY b.user_id, u.username, u.role`,
  },
  {
    // total_exposures (header wala number) = rows se nikla number.
    key: 'staleExposureSnapshot',
    severity: 'high',
    label: 'total_exposures snapshot matches the exposure rows under it',
    sql: `
      SELECT CAST(te.user_id AS TEXT) AS user_id, u.username, u.role,
        'header shows ' || ROUND(te.total_exposure::numeric,2)
        || ' but the rows derive ' || ROUND(COALESCE(d.derived,0)::numeric,2) AS detail
      FROM mssports.total_exposures te
      JOIN ${PLAYERS} u ON u.id = te.user_id
      LEFT JOIN (
        SELECT user_id, SUM(m) AS derived FROM (
          SELECT user_id, MIN(exposure_amount) AS m
            FROM ${EXPOSURE}
           WHERE (category <> 'casino' OR game_type LIKE '%:%') AND game_type IS NOT NULL
             AND game_type NOT IN ${FANCY_GT} AND game_type NOT LIKE '%Overs Line%' AND ${NOT_BACKLAY}
           GROUP BY user_id, match_id, game_type, event_id
          UNION ALL
          SELECT user_id, exposure_amount FROM ${EXPOSURE}
           WHERE ( (category = 'casino' AND (game_type IS NULL OR game_type NOT LIKE '%:%'))
                   OR game_type IS NULL OR game_type IN ${FANCY_GT}
                   OR game_type LIKE '%Overs Line%' )
             AND (category = 'casino' OR ${NOT_BACKLAY})
        ) q GROUP BY user_id
      ) d ON d.user_id = te.user_id
      WHERE ABS(te.total_exposure - COALESCE(d.derived,0)) > 0.01`,
  },
  {
    // Void group ki kam se kam ek refund row honi chahiye (zip: 2026-08-23 ke baad wale).
    key: 'voidRefundMissing',
    severity: 'high',
    label: 'Every void group returned its exposure to the wallet (refund row exists)',
    sql: `
      WITH v AS (
        SELECT b.id, b.user_id, b.match_id, b.market_type,
               CASE WHEN b.market_type IN ${FANCY_GT} OR b.market_type ILIKE '%line'
                    THEN b.selection_name ELSE '<market>' END AS bucket_key
          FROM ${BET} b
         WHERE LOWER(COALESCE(b.result_status,'')) IN ('refunded','void')
           AND COALESCE(b.match_end_time, b.updated_at) >= TIMESTAMPTZ '2026-08-23'
      )
      SELECT CAST(v.user_id AS TEXT) AS user_id, u.username, u.role,
        COUNT(*) || ' voided bet(s) on ' || v.market_type
          || ' with no refund row for the group (exposure released to nobody)' AS detail
      FROM v JOIN ${PLAYERS} u ON u.id = v.user_id
      GROUP BY v.user_id, u.username, u.role, v.match_id, v.market_type, v.bucket_key
      HAVING SUM(CASE WHEN EXISTS (SELECT 1 FROM ${LEDGER} l
                                    WHERE l.bet_id = v.id AND LOWER(l.reason) IN ('refund','settlement_void'))
                      THEN 1 ELSE 0 END) = 0`,
  },
  {
    // Har void ki bet_void_audit row.
    key: 'voidNotAudited',
    severity: 'high',
    label: 'Every voided bet has a bet_void_audit row',
    sql: `
      SELECT CAST(b.user_id AS TEXT) AS user_id, u.username, u.role,
        COUNT(*) || ' voided bet(s) with no audit row (e.g. bet ' || MIN(b.id) || ')' AS detail
      FROM ${BET} b
      JOIN ${PLAYERS} u ON u.id = b.user_id
      WHERE LOWER(COALESCE(b.result_status,'')) IN ('refunded','void','refund')
        AND NOT EXISTS (SELECT 1 FROM mssports.bet_void_audit a
                         WHERE a.bet_kind = 'SPORTS' AND a.bet_id = b.id)
      GROUP BY b.user_id, u.username, u.role`,
  },
];

const CHECKS = [...CORE_CHECKS, ...HIERARCHY_CHECKS];

module.exports = { CHECKS, ACCOUNTS, PLAYERS, FANCY_GT, NOT_BACKLAY, BET, LEDGER, EXPOSURE };

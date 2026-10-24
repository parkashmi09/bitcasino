'use strict';

const { QueryTypes } = require('sequelize');

/**
 * System Tracker > Watchdog — zip ka `systemTracker/watchdog.js`.
 *
 * "Kaunsa MARKET settle nahi ho raha?" — match khatam hue ghante ho gaye par bets open,
 * result declare hua par settle nahi, settlement job atka hua, exposure release nahi hua,
 * result feed chup.
 *
 * Paisa yahan se kabhi nahi hilta. Har finding ke saath "kya karna hai" aur kaunsi screen —
 * void/settle wahi Settlement screens karti hain, apne transaction password ke saath.
 * Casino wala check (stuckCasinoBet) nahi — is project me table casino nahi.
 */

const STALE_HOURS = Number(process.env.WATCHDOG_STALE_HOURS) || 3;
const JOB_STUCK_MIN = Number(process.env.WATCHDOG_JOB_STUCK_MIN) || 30;
const FEED_SILENT_MIN = Number(process.env.WATCHDOG_FEED_SILENT_MIN) || 30;
const POLL_SILENT_MIN = Number(process.env.WATCHDOG_POLL_SILENT_MIN) || 30;
const NEVER_DECLARED_HOURS = Number(process.env.WATCHDOG_NEVER_DECLARED_HOURS) || 12;
const SETTLE_GRACE_MIN = Number(process.env.WATCHDOG_SETTLE_GRACE_MIN) || 15;

const SERVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const FEED_TZ = process.env.FEED_TIMEZONE || 'Asia/Kolkata';

const BET = 'mssports."SportsBet"';
const SCAN = 'mssports.sports_event_result_scan';
const SB_FANCY = `b.game_type = 'FAN'`;
const SB_NOT_FANCY = `COALESCE(b.game_type,'') <> 'FAN'`;
const OPEN_BET = `LOWER(b.status) NOT IN ('closed','void','cancelled')`;
// Feed match_start_time bina timezone ke bhejta hai — zip jaisa server tz → feed tz.
const MATCH_START = `((b.match_start_time AT TIME ZONE :serverTz) AT TIME ZONE :feedTz)`;
const AGE_HOURS = `ROUND((EXTRACT(EPOCH FROM (now() - MIN(${MATCH_START})))/3600)::numeric,1)`;

const POLL_WENT_SILENT = `NOT EXISTS (SELECT 1 FROM ${SCAN} r WHERE r.eventid = b.eventid
  AND CAST(r.user_id AS TEXT) = CAST(b.user_id AS TEXT) AND r.checked_at > now() - (:pollSilentMin * interval '1 minute'))`;
const POLL_STILL_ACTIVE = `EXISTS (SELECT 1 FROM ${SCAN} r WHERE r.eventid = b.eventid
  AND CAST(r.user_id AS TEXT) = CAST(b.user_id AS TEXT) AND r.checked_at > now() - (:pollSilentMin * interval '1 minute'))`;
const NOT_DECLARED = `NOT EXISTS (SELECT 1 FROM ${SCAN} r WHERE r.eventid = b.eventid
  AND CAST(r.user_id AS TEXT) = CAST(b.user_id AS TEXT) AND r.declared = true)`;

/** Har check ki rows: ref_key, event_id, match_id, market_type, game_type, title, detail, bets_count, stake_total, stale_hours */
const WATCHDOG_CHECKS = [
  {
    key: 'resultDeclaredNotSettled',
    severity: 'critical',
    label: 'Result declared but bets never settled',
    suggested_action: 'Result has been declared well past the settlement window. Re-run settlement for this event; if it will not settle, void the market.',
    action_endpoint: 'POST /admin/sports/internalsettle/declareresult',
    sql: `
      SELECT b.eventid || ':' || COALESCE(b.market_type,'-') AS ref_key,
             b.eventid AS event_id, b.match_id, b.market_type, b.game_type,
             MAX(b.match_title) AS title,
             COUNT(*) || ' bet(s) still open although the result is declared' AS detail,
             COUNT(*)::int AS bets_count, ROUND(SUM(b.stake_amount)::numeric,2) AS stake_total,
             ${AGE_HOURS} AS stale_hours
        FROM ${BET} b
       WHERE ${OPEN_BET}
         AND EXISTS (SELECT 1 FROM ${SCAN} r
                      WHERE r.eventid = b.eventid AND CAST(r.user_id AS TEXT) = CAST(b.user_id AS TEXT)
                        AND r.declared = true
                        AND r.checked_at < now() - (:settleGraceMin * interval '1 minute'))
       GROUP BY b.eventid, b.market_type, b.match_id, b.game_type`,
  },
  {
    key: 'staleOpenMarket',
    severity: 'high',
    label: 'Open bets on a match that started hours ago',
    suggested_action: 'Check the result feed. Declare the result, or void the market if it will never settle.',
    action_endpoint: 'POST /admin/sports/internalsettle/declareresult | /void',
    sql: `
      SELECT b.eventid || ':' || COALESCE(b.market_type,'-') AS ref_key,
             b.eventid AS event_id, b.match_id, b.market_type, b.game_type,
             MAX(b.match_title) AS title,
             COUNT(*) || ' bet(s) open ' || ${AGE_HOURS} || 'h after the match started' AS detail,
             COUNT(*)::int AS bets_count, ROUND(SUM(b.stake_amount)::numeric,2) AS stake_total,
             ${AGE_HOURS} AS stale_hours
        FROM ${BET} b
       WHERE ${OPEN_BET}
         AND b.match_start_time IS NOT NULL
         AND ${MATCH_START} < now() - (:staleHours * interval '1 hour')
         AND ${SB_NOT_FANCY}
         AND ${NOT_DECLARED}
         AND ${POLL_WENT_SILENT}
       GROUP BY b.eventid, b.market_type, b.match_id, b.game_type`,
  },
  {
    key: 'staleFancy',
    severity: 'high',
    label: 'Open fancy bets on a match that started hours ago',
    suggested_action: 'Settle the fancy market, or void it if no result will come.',
    action_endpoint: 'POST /admin/sports/internalsettle/declareresult | /void-single-bet',
    sql: `
      SELECT b.eventid || ':fancy:' || COALESCE(b.fancy_name, b.market_type, '-') AS ref_key,
             b.eventid AS event_id, b.match_id, b.market_type, b.game_type,
             MAX(COALESCE(b.fancy_name, b.match_title)) AS title,
             COUNT(*) || ' fancy bet(s) open ' || ${AGE_HOURS} || 'h after the match started' AS detail,
             COUNT(*)::int AS bets_count, ROUND(SUM(b.stake_amount)::numeric,2) AS stake_total,
             ${AGE_HOURS} AS stale_hours
        FROM ${BET} b
       WHERE ${OPEN_BET}
         AND b.match_start_time IS NOT NULL
         AND ${MATCH_START} < now() - (:staleHours * interval '1 hour')
         AND ${SB_FANCY}
         AND ${NOT_DECLARED}
         AND ${POLL_WENT_SILENT}
       GROUP BY b.eventid, b.match_id, b.market_type, b.game_type, COALESCE(b.fancy_name, b.market_type, '-')`,
  },
  {
    key: 'resultNeverDeclared',
    severity: 'high',
    label: 'Results cron polling for hours but the feed never declares',
    suggested_action:
      'The cron is polling this event and getting nothing back. Check the feed for this sport, then declare or void the market.',
    action_endpoint: 'POST /admin/sports/internalsettle/declareresult | /void',
    sql: `
      SELECT b.eventid || ':nodecl:' || COALESCE(b.market_type,'-') AS ref_key,
             b.eventid AS event_id, b.match_id, b.market_type, b.game_type,
             MAX(b.match_title) AS title,
             COUNT(*) || ' bet(s) open ' || ${AGE_HOURS}
             || 'h after the match started - the cron is still polling (sport_id '
             || COALESCE(MAX(b.sport_id),'?') || ') but no result has ever been declared' AS detail,
             COUNT(*)::int AS bets_count, ROUND(SUM(b.stake_amount)::numeric,2) AS stake_total,
             ${AGE_HOURS} AS stale_hours
        FROM ${BET} b
       WHERE ${OPEN_BET}
         AND b.match_start_time IS NOT NULL
         AND ${MATCH_START} < now() - (:neverDeclaredHours * interval '1 hour')
         AND ${NOT_DECLARED}
         AND ${POLL_STILL_ACTIVE}
         AND EXISTS (SELECT 1 FROM ${SCAN} r
                      WHERE r.eventid = b.eventid AND CAST(r.user_id AS TEXT) = CAST(b.user_id AS TEXT)
                        AND r.counts ->> 'feed' IN ('unknown','complete'))
       GROUP BY b.eventid, b.market_type, b.match_id, b.game_type`,
  },
  {
    key: 'stuckSettlementJob',
    severity: 'critical',
    label: 'Settlement job wedged in queued/processing',
    suggested_action: 'Check the sports settlement worker. Requeue the job.',
    action_endpoint: null,
    sql: `
      SELECT j.job_id::text AS ref_key, j.eventid AS event_id, NULL::text AS match_id,
             NULL::text AS market_type, j.bet_type AS game_type,
             'settlement job ' || j.status AS title,
             'job stuck in ' || j.status || ' since ' || to_char(j.updated_at,'YYYY-MM-DD HH24:MI') AS detail,
             1 AS bets_count, 0::numeric AS stake_total,
             ROUND((EXTRACT(EPOCH FROM (now() - j.updated_at))/3600)::numeric,1) AS stale_hours
        FROM mssports.sports_event_settlement_jobs j
       WHERE j.status IN ('queued','processing')
         AND j.updated_at < now() - (:jobStuckMin * interval '1 minute')`,
  },
  {
    key: 'exposureNotReleased',
    severity: 'high',
    label: 'Exposure still held for a market with no open bets',
    suggested_action: 'Recompute the user exposure for this match — the bet closed but the lock did not lift.',
    action_endpoint: null,
    sql: `
      SELECT 'exp:' || e.match_id || ':' || CAST(e.user_id AS TEXT) AS ref_key,
             e.event_id::text AS event_id, e.match_id::text AS match_id, e.game_type AS market_type, e.game_type,
             COALESCE(u.name, CAST(e.user_id AS TEXT)) AS title,
             'exposure ' || ROUND(e.exposure_amount::numeric,2)
             || ' still held although no bet is open on this match' AS detail,
             1 AS bets_count, ROUND(ABS(e.exposure_amount)::numeric,2) AS stake_total,
             NULL::numeric AS stale_hours
        FROM mssports.user_exposures e
        LEFT JOIN public.users u ON u.id = e.user_id
       WHERE COALESCE(e.category,'') <> 'casino' AND e.match_id IS NOT NULL
         AND ABS(COALESCE(e.exposure_amount,0)) > 0.01
         AND NOT EXISTS (SELECT 1 FROM ${BET} b
                          WHERE b.match_id = e.match_id AND b.user_id = e.user_id AND ${OPEN_BET})`,
  },
  {
    key: 'feedSilent',
    severity: 'critical',
    label: 'Result feed has gone quiet',
    suggested_action: 'Check the sports results worker before actioning any stale market below.',
    action_endpoint: null,
    sql: `
      SELECT 'feed:results' AS ref_key, NULL::text AS event_id, NULL::text AS match_id,
             NULL::text AS market_type, NULL::text AS game_type,
             'sports result feed' AS title,
             'no result scan written for ' ||
             ROUND((EXTRACT(EPOCH FROM (now() - MAX(r.checked_at)))/60)::numeric,0) || ' minutes' AS detail,
             0 AS bets_count, 0::numeric AS stake_total,
             ROUND((EXTRACT(EPOCH FROM (now() - MAX(r.checked_at)))/3600)::numeric,1) AS stale_hours
        FROM ${SCAN} r
      HAVING MAX(r.checked_at) < now() - (:feedSilentMin * interval '1 minute')
         -- koi open bet hi nahi to feed ka chup rehna problem nahi
         AND EXISTS (SELECT 1 FROM ${BET} b WHERE ${OPEN_BET})`,
  },
];

const THRESHOLDS = { STALE_HOURS, JOB_STUCK_MIN, FEED_SILENT_MIN, POLL_SILENT_MIN, NEVER_DECLARED_HOURS, SETTLE_GRACE_MIN };

const select = (sequelize, sql, replacements = {}) => sequelize.query(sql, { type: QueryTypes.SELECT, replacements });

/** Sweep now — saare checks, upsert, aur jo ab nahi dikhe wo resolve. */
async function scanWatchdog(sequelize, logger) {
  const ts = new Date();
  const replacements = {
    staleHours: STALE_HOURS,
    jobStuckMin: JOB_STUCK_MIN,
    feedSilentMin: FEED_SILENT_MIN,
    pollSilentMin: POLL_SILENT_MIN,
    settleGraceMin: SETTLE_GRACE_MIN,
    neverDeclaredHours: NEVER_DECLARED_HOURS,
    serverTz: SERVER_TZ,
    feedTz: FEED_TZ,
  };
  let total = 0;
  const byKind = {};

  for (const check of WATCHDOG_CHECKS) {
    try {
      const rows = await select(sequelize, check.sql, replacements);
      byKind[check.key] = rows.length;
      for (const r of rows) {
        total += 1;
        await sequelize.query(
          `INSERT INTO mssports.settlement_watchdog
             (kind, ref_key, label, event_id, match_id, market_type, game_type, title,
              severity, detail, bets_count, stake_total, stale_hours,
              suggested_action, action_endpoint, first_seen, last_seen, resolved_at)
           VALUES (:kind, :ref_key, :label, :event_id, :match_id, :market_type, :game_type, :title,
                   :severity, :detail, :bets_count, :stake_total, :stale_hours,
                   :suggested_action, :action_endpoint, :ts, :ts, NULL)
           ON CONFLICT (kind, ref_key) DO UPDATE SET
             label = EXCLUDED.label, title = EXCLUDED.title, severity = EXCLUDED.severity,
             detail = EXCLUDED.detail, bets_count = EXCLUDED.bets_count, stake_total = EXCLUDED.stake_total,
             stale_hours = EXCLUDED.stale_hours, suggested_action = EXCLUDED.suggested_action,
             action_endpoint = EXCLUDED.action_endpoint, last_seen = :ts,
             first_seen = CASE WHEN mssports.settlement_watchdog.resolved_at IS NULL
                               THEN mssports.settlement_watchdog.first_seen ELSE :ts END,
             acknowledged_by = CASE WHEN mssports.settlement_watchdog.resolved_at IS NULL
                                    THEN mssports.settlement_watchdog.acknowledged_by ELSE NULL END,
             acknowledged_at = CASE WHEN mssports.settlement_watchdog.resolved_at IS NULL
                                    THEN mssports.settlement_watchdog.acknowledged_at ELSE NULL END,
             resolved_at = NULL`,
          {
            replacements: {
              kind: check.key,
              ref_key: String(r.ref_key),
              label: check.label,
              event_id: r.event_id ?? null,
              match_id: r.match_id ?? null,
              market_type: r.market_type ?? null,
              game_type: r.game_type ?? null,
              title: r.title ?? null,
              severity: check.severity,
              detail: r.detail ?? null,
              bets_count: r.bets_count ?? null,
              stake_total: r.stake_total ?? 0,
              stale_hours: r.stale_hours ?? null,
              suggested_action: check.suggested_action,
              action_endpoint: check.action_endpoint,
              ts,
            },
          }
        );
      }
    } catch (error) {
      logger?.error({ check: check.key, err: error.message }, 'Watchdog check failed');
    }
  }

  await sequelize.query(
    'UPDATE mssports.settlement_watchdog SET resolved_at = :ts WHERE resolved_at IS NULL AND last_seen < :ts',
    { replacements: { ts } }
  );
  return { scannedAt: ts.toISOString(), total, byKind };
}

/** Board — khule findings (critical pehle). `includeResolved` = purane bhi. */
async function getActiveWatchdog(sequelize, { includeResolved = false } = {}) {
  const findings = await select(
    sequelize,
    `SELECT * FROM mssports.settlement_watchdog
      ${includeResolved ? '' : 'WHERE resolved_at IS NULL'}
      ORDER BY (severity = 'critical') DESC, stale_hours DESC NULLS LAST, id DESC
      LIMIT 500`
  );
  const open = findings.filter((f) => !f.resolved_at);
  const [last] = await select(sequelize, 'SELECT MAX(last_seen) AS last FROM mssports.settlement_watchdog');
  return {
    count: open.length,
    critical: open.filter((f) => f.severity === 'critical').length,
    unattended: open.filter((f) => !f.acknowledged_by).length,
    stakeAtRisk: Number(open.reduce((s, f) => s + Number(f.stake_total || 0), 0).toFixed(2)),
    findings,
    thresholds: THRESHOLDS,
    lastScan: last ? last.last : null,
  };
}

/** "I am handling this" — sirf apni table ki row, paisa nahi. */
async function acknowledgeFinding(sequelize, id, who) {
  const [rows] = await sequelize.query(
    `UPDATE mssports.settlement_watchdog
        SET acknowledged_by = :who, acknowledged_at = now()
      WHERE id = :id AND resolved_at IS NULL
      RETURNING *`,
    { replacements: { id, who: String(who) } }
  );
  return rows?.[0] ?? null;
}

module.exports = { scanWatchdog, getActiveWatchdog, acknowledgeFinding, WATCHDOG_CHECKS, THRESHOLDS };

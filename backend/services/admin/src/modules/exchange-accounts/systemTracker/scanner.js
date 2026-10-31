'use strict';

const { QueryTypes } = require('sequelize');

const { CHECKS } = require('./checks');

/**
 * System Tracker > Alerts — zip ka `systemTracker/scanner.js`.
 *
 * Saare checks chalao, galat accounts `mssports.integrity_alerts` me upsert karo, aur jo
 * is scan me nahi dikhe unhe resolve kar do. Paisa kabhi nahi chhuta — sirf padhta hai.
 *
 * Do scan ek saath na chalein (warna ek doosre ke findings resolve kar dete hain), isliye
 * transaction wala advisory lock — doosra caller `{ skipped: true }` paata hai.
 */

const SCAN_LOCK_KEY = 918273645;

const select = (sequelize, sql, replacements = {}, transaction) =>
  sequelize.query(sql, { type: QueryTypes.SELECT, replacements, transaction });

async function runChecks(sequelize, logger) {
  const ts = new Date();
  let totalFindings = 0;
  const flagged = new Set();

  for (const check of CHECKS) {
    try {
      const rows = await select(sequelize, check.sql);
      for (const r of rows) {
        totalFindings += 1;
        flagged.add(r.user_id);
        await sequelize.query(
          `INSERT INTO mssports.integrity_alerts
             (user_id, username, role, check_key, label, detail, severity, detected_at, updated_at, resolved_at)
           VALUES (:user_id, :username, :role, :check_key, :label, :detail, :severity, :ts, :ts, NULL)
           ON CONFLICT (user_id, check_key) DO UPDATE SET
             username = EXCLUDED.username, role = EXCLUDED.role, label = EXCLUDED.label,
             detail = EXCLUDED.detail, severity = EXCLUDED.severity, updated_at = :ts,
             detected_at = CASE WHEN mssports.integrity_alerts.resolved_at IS NULL
                                THEN mssports.integrity_alerts.detected_at ELSE :ts END,
             resolved_at = NULL`,
          {
            replacements: {
              user_id: String(r.user_id),
              username: r.username || null,
              role: r.role || null,
              check_key: check.key,
              label: check.label,
              detail: r.detail || null,
              severity: check.severity,
              ts,
            },
          }
        );
      }
    } catch (error) {
      // Ek kharab check poora scan na roke.
      logger?.error({ check: check.key, err: error.message }, 'System tracker check failed');
    }
  }

  // Jo is scan me refresh nahi hua, wo ab pass hai.
  await sequelize.query(
    `UPDATE mssports.integrity_alerts SET resolved_at = :ts, updated_at = :ts
      WHERE resolved_at IS NULL AND updated_at < :ts`,
    { replacements: { ts } }
  );

  return { scannedAt: ts.toISOString(), totalFindings, flaggedUsers: flagged.size };
}

/** Re-scan now. */
async function scanAllAccounts(sequelize, logger) {
  const lockTx = await sequelize.transaction();
  try {
    const [row] = await select(sequelize, 'SELECT pg_try_advisory_xact_lock(:key) AS got', { key: SCAN_LOCK_KEY }, lockTx);
    if (!row || row.got !== true) {
      await lockTx.rollback();
      return { skipped: true, reason: 'another scan is already running', totalFindings: 0, flaggedUsers: 0 };
    }
    const result = await runChecks(sequelize, logger);
    await lockTx.commit();
    return result;
  } catch (error) {
    try {
      await lockTx.rollback();
    } catch {
      /* pehle hi commit/rollback ho chuka */
    }
    throw error;
  }
}

/** Cached findings, account-wise (scan nahi chalta). */
async function getActiveAlerts(sequelize) {
  const rows = await select(
    sequelize,
    `SELECT user_id, username, role, check_key, label, detail, severity, detected_at
       FROM mssports.integrity_alerts WHERE resolved_at IS NULL
      ORDER BY user_id, check_key`
  );

  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user_id: r.user_id, username: r.username, role: r.role, issues: [] });
    byUser.get(r.user_id).issues.push({ key: r.check_key, label: r.label, detail: r.detail, severity: r.severity, since: r.detected_at });
  }
  const [last] = await select(sequelize, 'SELECT MAX(updated_at) AS last FROM mssports.integrity_alerts');

  // Bell sirf actionable ginta hai; 'info' wale list me dikhte hain par count me nahi.
  const actionableRows = rows.filter((r) => r.severity !== 'info');
  return {
    count: byUser.size,
    totalIssues: rows.length,
    actionable: actionableRows.length,
    actionableUsers: new Set(actionableRows.map((r) => r.user_id)).size,
    informational: rows.length - actionableRows.length,
    users: [...byUser.values()],
    lastScan: last ? last.last : null,
  };
}

module.exports = { scanAllAccounts, getActiveAlerts, runChecks };

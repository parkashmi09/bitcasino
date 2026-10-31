'use strict';

/**
 * System Tracker ki tables (zip msadmin), schema `mssports` me. Screen ab owner panel me hai.
 *
 *   integrity_alerts     System Tracker > Alerts   (zip systemTracker/scanner.js)
 *   settlement_watchdog  System Tracker > Watchdog (zip systemTracker/watchdog.js)
 *
 * Zip ye tables boot pe `CREATE TABLE IF NOT EXISTS` se banata tha; yahan migration se.
 * Idempotent: dobara chalane pe kuch nahi badalta.
 */

async function up({ sequelize, transaction }) {
  const run = (sql) => sequelize.query(sql, { transaction });

  await run('CREATE SCHEMA IF NOT EXISTS mssports');

  // Account-wise integrity findings. user_id = player id, ya 'staff:<id>' / 'wallet:<id>'.
  await run(`
    CREATE TABLE IF NOT EXISTS mssports.integrity_alerts (
      id           SERIAL PRIMARY KEY,
      user_id      TEXT NOT NULL,
      username     TEXT,
      role         TEXT,
      check_key    TEXT NOT NULL,
      label        TEXT,
      detail       TEXT,
      severity     TEXT DEFAULT 'high',
      detected_at  TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now(),
      resolved_at  TIMESTAMPTZ,
      UNIQUE (user_id, check_key)
    )`);

  // Market-wise "kya atka hua hai" findings.
  await run(`
    CREATE TABLE IF NOT EXISTS mssports.settlement_watchdog (
      id               SERIAL PRIMARY KEY,
      kind             TEXT NOT NULL,
      ref_key          TEXT NOT NULL,
      label            TEXT,
      event_id         TEXT,
      match_id         TEXT,
      market_type      TEXT,
      game_type        TEXT,
      title            TEXT,
      severity         TEXT DEFAULT 'high',
      detail           TEXT,
      bets_count       INTEGER,
      stake_total      NUMERIC(18,2),
      stale_hours      NUMERIC(10,2),
      suggested_action TEXT,
      action_endpoint  TEXT,
      first_seen       TIMESTAMPTZ DEFAULT now(),
      last_seen        TIMESTAMPTZ DEFAULT now(),
      acknowledged_by  TEXT,
      acknowledged_at  TIMESTAMPTZ,
      resolved_at      TIMESTAMPTZ,
      UNIQUE (kind, ref_key)
    )`);
  await run('CREATE INDEX IF NOT EXISTS settlement_watchdog_active ON mssports.settlement_watchdog (resolved_at, severity)');
}

async function down({ sequelize, transaction }) {
  const run = (sql) => sequelize.query(sql, { transaction });
  for (const table of ['settlement_watchdog', 'integrity_alerts']) {
    await run(`DROP TABLE IF EXISTS mssports.${table}`);
  }
}

module.exports = { up, down };

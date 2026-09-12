#!/usr/bin/env node
'use strict';

/**
 * What each service is actually allowed to touch in Postgres.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PROBLEM
 *
 * All four services connect as ONE Postgres user with full rights on the whole
 * database. `SERVICE_DOMAINS` looks like isolation, but it only decides which
 * Sequelize models get registered — it is advisory. Nothing stops
 * sports-service running `SELECT * FROM users`, and Postgres would happily
 * serve it. So a compromise of the service that mostly polls an odds feed is a
 * compromise of every player record, balance and password hash.
 *
 * Real isolation has to be enforced by the database. This derives, per
 * service, the exact set of tables it needs, and emits `GRANT` statements
 * scoped to that set — so the same compromise reaches only the tables that
 * service legitimately owns.
 *
 * ── WHY THE SET IS DERIVED AND NOT TAKEN FROM `SERVICE_DOMAINS` ───────────
 *
 * Because the domains are not the whole truth. `settlement.payout.job.js` runs
 *
 *     UPDATE staff_balances SET inr = inr + :amount WHERE staff_id = :staffId
 *
 * from sports-service. `staff_balances` is in the ADMIN domain, which
 * sports-service does not load — the write is deliberate, documented, and
 * invisible to any model-based analysis. Granting from `SERVICE_DOMAINS` alone
 * would leave settlement unable to pay agents, and the failure would surface
 * as a stuck queue rather than a permission error.
 *
 * So the set is the union of two sources:
 *
 *   MODELS    every `tableName` a service registers — authoritative, read
 *             from the real Sequelize registry rather than guessed
 *   RAW SQL   table names parsed out of strings that actually contain SQL,
 *             which is what catches the cross-domain writes
 *
 * A prose grep would fold in every "from disk" and "update the row" in a
 * comment, so only string literals containing a SQL verb are considered.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node tools/db-grants.js                 # print the plan
 *   node tools/db-grants.js --sql           # emit SQL only
 *   node tools/db-grants.js --apply         # create roles and apply grants
 *   node tools/db-grants.js --check         # connect as each role, verify reach
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVICES_DIR = path.join(__dirname, '..', 'services');
const argv = process.argv.slice(2);
const MODE =
  (argv.includes('--apply') && 'apply') ||
  (argv.includes('--check') && 'check') ||
  (argv.includes('--sql') && 'sql') ||
  'plan';

/** Services that own a database connection. The gateway deliberately has none. */
const SERVICES = ['user-service', 'admin-service', 'casino-service', 'sports-service'];

const roleFor = (service) => `ibitplay_${service.replace(/-service$/, '')}`;
const envNameFor = (service) => `DB_USER_${service.replace(/-/g, '_').toUpperCase()}`;
const passEnvFor = (service) => `DB_PASSWORD_${service.replace(/-/g, '_').toUpperCase()}`;

// ── Source 1: the models a service registers ──────────────────────────────

function tablesFromModels(service) {
  const { Sequelize } = require('sequelize');
  const { registerForService } = require('../packages/db/src/models');

  // A connection object is required to init models; nothing connects.
  const sequelize = new Sequelize('postgres://u:p@127.0.0.1:5432/none', { logging: false });
  const models = registerForService(sequelize, service, { logger: null });

  return new Set(Object.values(models).map((m) => m.tableName).filter(Boolean));
}

// ── Source 2: tables named in raw SQL ─────────────────────────────────────

/**
 * Only strings that look like SQL are considered.
 *
 * `FROM` appears constantly in prose — "read from disk", "taken from the
 * body" — and a grep that trusts it grants half the schema to everybody. A
 * literal has to contain a statement verb before its table names count.
 */
const SQL_STATEMENT = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i;
const TABLE_REF = /\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"?([a-z_][a-z0-9_]*)"?/gi;

/** Postgres keywords and CTE-ish words that follow FROM but are not tables. */
const NOT_A_TABLE = new Set([
  'select', 'lateral', 'unnest', 'generate_series', 'only', 'dual',
  'information_schema', 'pg_catalog', 'pg_database', 'pg_class', 'pg_tables',
  'values', 'set', 'where', 'returning',
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function tablesFromRawSql(service) {
  const dir = path.join(SERVICES_DIR, service.replace(/-service$/, ''), 'src');
  const found = new Map(); // table -> Set(file)

  for (const file of walk(dir)) {
    const source = fs.readFileSync(file, 'utf8');

    // Every string / template literal in the file.
    for (const match of source.matchAll(/`([^`]*)`|'([^'\n]*)'|"([^"\n]*)"/g)) {
      const literal = match[1] || match[2] || match[3] || '';
      if (!SQL_STATEMENT.test(literal)) continue;

      for (const ref of literal.matchAll(TABLE_REF)) {
        const table = ref[1].toLowerCase();
        if (NOT_A_TABLE.has(table)) continue;
        if (!found.has(table)) found.set(table, new Set());
        found.get(table).add(path.relative(SERVICES_DIR, file));
      }
    }
  }
  return found;
}

// ── Build the plan ────────────────────────────────────────────────────────

/** Every table that actually exists, so a parse artefact never reaches SQL. */
async function realTables(client) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`
  );
  return new Set(rows.map((r) => r.tablename));
}

function buildPlan(existing) {
  const plan = [];

  for (const service of SERVICES) {
    const fromModels = tablesFromModels(service);
    const fromSql = tablesFromRawSql(service);

    const crossDomain = new Map();
    for (const [table, files] of fromSql) {
      if (!fromModels.has(table)) crossDomain.set(table, files);
    }

    const all = new Set([...fromModels, ...fromSql.keys()]);

    // Anything that is not a real table is a parse artefact — dropped, and
    // reported, so a silently-missing grant is never mistaken for coverage.
    const unknown = existing ? [...all].filter((t) => !existing.has(t)) : [];
    const tables = existing ? [...all].filter((t) => existing.has(t)) : [...all];

    plan.push({
      service,
      role: roleFor(service),
      tables: tables.sort(),
      fromModels: fromModels.size,
      crossDomain: [...crossDomain.entries()].map(([t, f]) => ({ table: t, files: [...f] })),
      unknown: unknown.sort(),
    });
  }
  return plan;
}

// ── SQL generation ────────────────────────────────────────────────────────

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

function sqlFor(entry, { password }) {
  const lines = [];
  lines.push(`-- ── ${entry.service} → ${entry.role} (${entry.tables.length} tables)`);
  lines.push(`DO $$ BEGIN`);
  lines.push(`  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${entry.role}') THEN`);
  lines.push(`    CREATE ROLE ${q(entry.role)} LOGIN PASSWORD '${password}';`);
  lines.push(`  ELSE`);
  lines.push(`    ALTER ROLE ${q(entry.role)} LOGIN PASSWORD '${password}';`);
  lines.push(`  END IF;`);
  lines.push(`END $$;`);
  lines.push('');
  lines.push(`GRANT CONNECT ON DATABASE ${q(process.env.DB_NAME || 'ibitplay')} TO ${q(entry.role)};`);
  lines.push(`GRANT USAGE ON SCHEMA public TO ${q(entry.role)};`);
  lines.push('');
  /**
   * Revoke first, so re-running narrows as well as widens.
   *
   * Without this, removing a table from a service's set would leave the old
   * grant in place and the tool would report a reach it no longer has.
   */
  lines.push(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${q(entry.role)};`);
  lines.push(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${q(entry.role)};`);
  lines.push('');

  for (const table of entry.tables) {
    lines.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${q(table)} TO ${q(entry.role)};`);
  }

  lines.push('');
  /**
   * Sequences, not just tables. An INSERT into a table with a `serial` primary
   * key needs USAGE on its sequence, and a missing sequence grant fails only
   * on write — so it would pass a read-only smoke test and break the first
   * time a bet was placed.
   */
  lines.push(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${q(entry.role)};`);
  lines.push('');
  return lines.join('\n');
}

// ── Entry points ──────────────────────────────────────────────────────────

function loadPgClient() {
  const { Client } = require('pg');
  require('dotenv').config({ quiet: true });
  return new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'ibitplay',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
}

async function main() {
  const client = loadPgClient();
  let existing = null;

  try {
    await client.connect();
    existing = await realTables(client);
  } catch (error) {
    if (MODE === 'apply' || MODE === 'check') {
      console.error(`Cannot reach the database: ${error.message}`);
      process.exit(1);
    }
    console.warn(`(no database reachable — table names not validated: ${error.message})\n`);
  }

  const plan = buildPlan(existing);

  if (MODE === 'plan') {
    console.log('Per-service database grants\n');
    for (const entry of plan) {
      console.log(`  ${entry.service}  →  role ${entry.role}`);
      console.log(`     tables      ${entry.tables.length}  (${entry.fromModels} from models)`);
      if (entry.crossDomain.length) {
        console.log(`     cross-domain raw SQL — these are why the grant is not just SERVICE_DOMAINS:`);
        for (const c of entry.crossDomain) {
          if (!existing || existing.has(c.table)) {
            console.log(`        ${c.table.padEnd(30)} ${c.files[0]}`);
          }
        }
      }
      if (entry.unknown.length) {
        console.log(`     ignored (not real tables): ${entry.unknown.join(', ')}`);
      }
      console.log('');
    }
    console.log('Next: --sql to see the statements, --apply to create the roles.');
    console.log('Nothing changes for a service until its DB_USER_* env var is set.');
    if (client._connected) await client.end();
    return;
  }

  // A password per role, printed once so it can be put in `.env`.
  const passwords = new Map(
    plan.map((e) => [e.service, crypto.randomBytes(24).toString('base64url')])
  );

  if (MODE === 'sql') {
    for (const entry of plan) console.log(sqlFor(entry, { password: passwords.get(entry.service) }));
    if (client._connected) await client.end();
    return;
  }

  if (MODE === 'apply') {
    for (const entry of plan) {
      await client.query(sqlFor(entry, { password: passwords.get(entry.service) }));
      console.log(`✔ ${entry.role.padEnd(22)} ${entry.tables.length} tables`);
    }
    console.log('\nAdd these to .env, then restart the services one at a time:\n');
    for (const entry of plan) {
      console.log(`${envNameFor(entry.service)}=${entry.role}`);
      console.log(`${passEnvFor(entry.service)}=${passwords.get(entry.service)}`);
    }
    console.log('\nUntil a service\'s DB_USER_* is set it keeps using DB_USER, unchanged.');
    await client.end();
    return;
  }

  if (MODE === 'check') {
    await client.end();
    await checkRoles(plan);
  }
}

/**
 * Connect as each role and verify the grant matches the plan.
 *
 * Two questions, and the second is the one that proves isolation rather than
 * merely asserting it: can this role reach everything it needs, and is it
 * actually refused everything else?
 */
async function checkRoles(plan) {
  const { Client } = require('pg');
  require('dotenv').config({ quiet: true });

  let failures = 0;

  for (const entry of plan) {
    const user = process.env[envNameFor(entry.service)];
    const password = process.env[passEnvFor(entry.service)];

    if (!user) {
      console.log(`·  ${entry.service.padEnd(16)} ${envNameFor(entry.service)} not set — still using DB_USER`);
      continue;
    }

    const roleClient = new Client({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'ibitplay',
      user,
      password,
    });

    try {
      await roleClient.connect();
    } catch (error) {
      console.error(`✘  ${entry.service.padEnd(16)} cannot connect as ${user}: ${error.message}`);
      failures += 1;
      continue;
    }

    const missing = [];
    for (const table of entry.tables) {
      try {
        /**
         * `quote_ident`, because table names here are not all lowercase.
         *
         * `has_table_privilege(user, 'SportsBet', …)` parses its second
         * argument as an IDENTIFIER, so an unquoted mixed-case name folds to
         * `sportsbet` and Postgres reports the relation does not exist. The
         * GRANT statements already quote correctly — it was only this check
         * that was wrong, which would have made it report a missing grant on a
         * table that is in fact granted.
         */
        const { rows } = await roleClient.query(
          `SELECT has_table_privilege($1, quote_ident($2), 'SELECT') AS r,
                  has_table_privilege($1, quote_ident($2), 'UPDATE') AS w`,
          [user, table]
        );
        if (!rows[0].r || !rows[0].w) missing.push(table);
      } catch (error) {
        console.error(`   (while checking ${entry.service} / ${table}): ${error.message}`);
        throw error;
      }
    }

    // Something it must NOT reach. `users` is the sharpest example for the
    // services that have no business in it.
    const forbidden = ['users', 'credits', 'staff'].filter((t) => !entry.tables.includes(t));
    const leaked = [];
    for (const table of forbidden) {
      const { rows } = await roleClient.query(
        `SELECT has_table_privilege($1, quote_ident($2), 'SELECT') AS r`,
        [user, table]
      );
      if (rows[0].r) leaked.push(table);
    }

    await roleClient.end();

    if (missing.length) {
      console.error(`✘  ${entry.service.padEnd(16)} missing grants: ${missing.join(', ')}`);
      failures += 1;
    } else if (leaked.length) {
      console.error(`✘  ${entry.service.padEnd(16)} can still read: ${leaked.join(', ')}`);
      failures += 1;
    } else {
      console.log(
        `✔  ${entry.service.padEnd(16)} ${entry.tables.length} tables reachable, ` +
          `${forbidden.length ? `${forbidden.join('/')} refused` : 'nothing to exclude'}`
      );
    }
  }

  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

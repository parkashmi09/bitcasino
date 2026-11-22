'use strict';

/**
 * Fixture ids for the DB-backed tests.
 *
 * The test database is shared (every CFZ site's suite runs against it) and a cut-off run leaves
 * its rows behind, so an id derived from `process.pid` sooner or later lands on somebody's
 * leftover row: a `users_pkey` duplicate, or a staff row another file's players still point at.
 *
 * A block comes from a Postgres sequence instead: never handed out twice, and its range starts
 * above every id the pid-based fixtures use (users < 1.1e9, staff < 1.4e6), so no leftover row
 * can sit in it. Staff ids stay inside INTEGER (`users.parent_staff_id` is one).
 *
 *   let nextUid;
 *   nextUid = await idBlock(connection.sequelize, 'users'); // then nextUid += 1 per player
 */

const BLOCK = 1000;
const STARTS = { users: 20_000_000_000, staff: 1_500_000_000 };

/** The first id of a fresh, unused block of 1,000 (`start + 1 … start + 999` are free). */
async function idBlock(sequelize, kind) {
  const start = STARTS[kind];
  if (!start) throw new Error(`idBlock: unknown kind "${kind}"`);
  const seq = `test_fixture_${kind}_ids`;
  await sequelize.query(`CREATE SEQUENCE IF NOT EXISTS ${seq} START ${start} MINVALUE ${start} INCREMENT ${BLOCK}`);
  const [[row]] = await sequelize.query(`SELECT nextval('${seq}')::text AS id`);
  return Number(row.id);
}

/**
 * Run the deletes in their order. A foreign key between two dependent tables (gis_transactions →
 * gis_sessions) can refuse one until the other has gone, so a refused delete is retried on the
 * next pass, while any pass still makes progress.
 */
async function runDeletes(sequelize, steps) {
  let pending = [...steps].sort((a, b) => a.order - b.order);
  let failures = [];
  while (pending.length) {
    failures = [];
    for (const step of pending) {
      try {
        await sequelize.query(step.sql, { replacements: { ids: step.ids } });
      } catch (error) {
        failures.push({ step, error });
      }
    }
    if (failures.length === pending.length) break;
    pending = failures.map((f) => f.step);
  }
  if (failures.length && failures.length === pending.length) throw failures[0].error;
}

/** Columns that hold a player's or a staff account's id, wherever a module keeps one. */
const OWNER_COLUMNS = {
  users: ['uid', 'user_id', 'userid', 'from_user_id', 'to_user_id'],
  staff: ['staff_id', 'parent_staff_id'],
};

const STAFF_SQL = `SELECT id FROM staff WHERE id BETWEEN :lo AND :hi OR parent_id BETWEEN :lo AND :hi
  UNION SELECT descendant_id FROM staff_hierarchy WHERE ancestor_id BETWEEN :lo AND :hi`;

const COLUMNS_SQL = `SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS col, c.data_type AS type
  FROM information_schema.columns c
  JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name
  WHERE x.table_type = 'BASE TABLE' AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
    AND c.column_name IN (:cols)`;

/**
 * Delete every row a block's fixtures left, in every table, so a test file leaves the shared
 * database as it found it. Nothing outside a test holds an id in a block; the accounts a service
 * created UNDER a block's staff (its own ids, from the table's sequence) go too.
 *
 * Best effort: the ids are unique whether or not this runs, so a cleanup failure is printed and
 * does not fail the file (and does not skip the hook that closes the connection).
 */
async function purgeBlocks(sequelize, blocks) {
  try {
    const select = (sql, replacements) => sequelize.query(sql, { replacements, type: 'SELECT' });
    const range = (start) => (start == null ? { lo: -1, hi: -1 } : { lo: start, hi: start + BLOCK - 1 });
    const ids = (rows) => rows.map((r) => String(r.id));

    const staff = ids(await select(STAFF_SQL, range(blocks.staff)));
    const users = ids(await select(
      'SELECT id FROM users WHERE id BETWEEN :lo AND :hi OR parent_staff_id::text IN (:staff)',
      { ...range(blocks.users), staff: staff.length ? staff : ['-1'] }
    ));
    const owned = { users, staff };
    const columns = await select(COLUMNS_SQL, { cols: [...OWNER_COLUMNS.users, ...OWNER_COLUMNS.staff] });

    // Dependent rows first, then `users`, then `staff`: the foreign keys point that way.
    const steps = [];
    for (const kind of ['users', 'staff']) {
      if (!owned[kind].length) continue;
      for (const { s, t, col } of columns) {
        if (!OWNER_COLUMNS[kind].includes(col)) continue;
        steps.push({ order: t === 'users' ? 1 : t === 'staff' ? 2 : 0, sql: `DELETE FROM "${s}"."${t}" WHERE "${col}"::text IN (:ids)`, ids: owned[kind] });
      }
      steps.push({ order: kind === 'users' ? 1 : 2, sql: `DELETE FROM "public"."${kind}" WHERE id::text IN (:ids)`, ids: owned[kind] });
    }
    await runDeletes(sequelize, steps);
  } catch (error) {
    console.error(`purgeBlocks: fixtures left behind (${error.message})`);
  }
}

/**
 * Ids at or above these are fixtures in the TEST database (the only seeded rows are the platform
 * root, staff 1, and a handful of low ids); every pid-based range and every block sits above them.
 */
const FIXTURE_FLOORS = { users: 1_000_000, staff: 100_000 };

/**
 * Before a suite run: delete every fixture row earlier runs left behind (cut-off runs, files that
 * do not clean up, other sites' runs on the same database). Most files still derive ids from
 * `process.pid`, so a leftover on one of those ids is what made a random handful of files fail
 * each run. Refuses any database whose name does not say it is a test one.
 */
async function sweepFixtures(sequelize) {
  const [[{ name }]] = await sequelize.query('SELECT current_database() AS name');
  if (!/test/i.test(name)) throw new Error(`sweepFixtures: refusing to sweep "${name}", not a test database`);

  const columns = await sequelize.query(COLUMNS_SQL, {
    replacements: { cols: [...OWNER_COLUMNS.users, ...OWNER_COLUMNS.staff] },
    type: 'SELECT',
  });
  const steps = [];
  for (const kind of ['users', 'staff']) {
    const floor = FIXTURE_FLOORS[kind];
    for (const { s, t, col, type } of columns) {
      if (!OWNER_COLUMNS[kind].includes(col)) continue;
      // A text column can hold anything; only an all-digit value is cast.
      const value = /char|text/.test(type) ? `(CASE WHEN "${col}" ~ '^[0-9]{1,19}$' THEN "${col}"::numeric END)` : `"${col}"`;
      steps.push({ order: t === 'users' ? 1 : t === 'staff' ? 2 : 0, sql: `DELETE FROM "${s}"."${t}" WHERE ${value} >= ${floor}` });
    }
    steps.push({ order: kind === 'users' ? 1 : 2, sql: `DELETE FROM "public"."${kind}" WHERE id >= ${floor}` });
  }
  await runDeletes(sequelize, steps);
}

module.exports = { idBlock, purgeBlocks, sweepFixtures, BLOCK };

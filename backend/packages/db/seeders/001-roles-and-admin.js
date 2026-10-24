'use strict';

/**
 * Bootstrap seed: the role ladder and the first super-admin.
 *
 * Without this there is no way to log into the admin service at all — every
 * staff route requires a staff token, and staff accounts can only be created by
 * an existing staff member. This breaks that circle exactly once.
 *
 * Idempotent: re-running updates nothing that already exists. In particular it
 * never resets an existing admin's password, so running `db:seed` against a
 * live database cannot hand the default credentials back to an attacker.
 */

const { hashPassword } = require('@ibitplay/auth');
const { STAFF_LEVELS } = require('@ibitplay/auth');

const ROLES = [
  { id: 1, name: 'Super Admin', level: STAFF_LEVELS.SUPER_ADMIN, responsibilities: 'Unrestricted access to every function.' },
  { id: 2, name: 'Admin', level: STAFF_LEVELS.ADMIN, responsibilities: 'Full operations access except role management.' },
  { id: 3, name: 'Sub Admin', level: STAFF_LEVELS.SUB_ADMIN, responsibilities: 'Player operations, payments and reporting.' },
  { id: 4, name: 'Super Master', level: STAFF_LEVELS.SUPER_MASTER, responsibilities: 'Manages masters and their downstream players.' },
  { id: 5, name: 'Master', level: STAFF_LEVELS.MASTER, responsibilities: 'Manages agents and their players.' },
  { id: 6, name: 'Agent', level: STAFF_LEVELS.AGENT, responsibilities: 'Creates and funds players directly.' },
  { id: 7, name: 'Executive', level: STAFF_LEVELS.EXECUTIVE, responsibilities: 'Read-only support account.' },
];

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  // ── Roles ────────────────────────────────────────────────────────────
  for (const role of ROLES) {
    await sequelize.query(
      `INSERT INTO roles (id, name, level, responsibilities)
       VALUES (:id, :name, :level, :responsibilities)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             level = EXCLUDED.level,
             responsibilities = EXCLUDED.responsibilities`,
      { replacements: role, transaction, type: QueryTypes.INSERT }
    );
  }

  // The roles above use explicit ids, so the sequence must be pushed past them
  // or the next auto-generated insert collides with id 1.
  await sequelize.query(
    `SELECT setval(pg_get_serial_sequence('roles', 'id'), GREATEST((SELECT MAX(id) FROM roles), 1))`,
    { transaction }
  );

  logger?.info(`Seeded ${ROLES.length} roles`);

  // ── Bootstrap super-admin ────────────────────────────────────────────
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@ibitplay.local';
  const name = process.env.SEED_ADMIN_USERNAME || 'superadmin';
  const plainPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2026';

  const existing = await sequelize.query('SELECT id FROM staff WHERE email = :email LIMIT 1', {
    replacements: { email },
    transaction,
    type: QueryTypes.SELECT,
  });

  if (existing.length) {
    logger?.info(`Super-admin ${email} already exists (id ${existing[0].id}) — password left untouched`);
    return;
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await hashPassword(plainPassword, rounds);

  const [inserted] = await sequelize.query(
    `INSERT INTO staff (name, email, password, role_id, status, first_login, percentage, created_at)
     VALUES (:name, :email, :password, 1, 'active', true, 0, now())
     RETURNING id`,
    { replacements: { name, email, password: passwordHash }, transaction, type: QueryTypes.SELECT }
  );

  const staffId = inserted?.id ?? inserted;

  await sequelize.query(
    `INSERT INTO staff_balances (staff_id, inr, credit_limit, exposure_limit, gt, casino_gt)
     VALUES (:staffId, 0, 0, 0, 0, 0)
     ON CONFLICT DO NOTHING`,
    { replacements: { staffId }, transaction }
  );

  // Closure table needs the self-referencing row at depth 0, or this staff
  // member is invisible to their own hierarchy queries.
  await sequelize.query(
    `INSERT INTO staff_hierarchy (ancestor_id, descendant_id, depth)
     VALUES (:staffId, :staffId, 0)
     ON CONFLICT DO NOTHING`,
    { replacements: { staffId }, transaction }
  );

  logger?.info(`Created super-admin: ${email} (staff id ${staffId})`);
  logger?.warn('Change the seeded admin password before exposing this environment.');
}

async function down({ sequelize, transaction }) {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@ibitplay.local';
  await sequelize.query('DELETE FROM staff WHERE email = :email', { replacements: { email }, transaction });
  await sequelize.query('DELETE FROM roles WHERE id <= 7', { transaction });
}

module.exports = { up, down, ROLES };

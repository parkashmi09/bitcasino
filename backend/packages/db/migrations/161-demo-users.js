'use strict';

/**
 * Demo users (user, 2026-10-27 — TENEXCH's "Demo" login).
 *
 * `users.is_demo` — a throwaway account made by the player site's Demo button: a DIRECT user
 * (`parent_staff_id` NULL), ₹1500, INR only, sports exchange bets only, no promotions, never
 * listed in the admin. `demo_expires_at` — its session ends then; the cleanup job deletes the
 * account and everything it made once it has expired and holds no open bet.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE,
       ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ`,
    { transaction }
  );
  await sequelize.query('CREATE INDEX IF NOT EXISTS users_demo_expires_idx ON users (demo_expires_at) WHERE is_demo', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS users_demo_expires_idx', { transaction });
  await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS demo_expires_at, DROP COLUMN IF EXISTS is_demo', { transaction });
}

module.exports = { up, down };

'use strict';

/**
 * Branches (owner policy `branch_management`, admin modules/branches).
 *
 * `branches` — a login the Super Admin makes. Not a staff row: a branch is outside the staff tree,
 * so no staff screen, agent ladder or sports wallet ever sees it. Its sessions die with
 * `token_version` (bumped on logout, password change and deactivation), like staff ones.
 *
 * `users.branch_id` — the branch that created the player. The player stays a DIRECT user
 * (`parent_staff_id` NULL: deposits, withdrawals and promotions as for any signup); the column
 * only says whose report it counts in. NULL = not a branch player.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS branches (
       id             SERIAL PRIMARY KEY,
       name           VARCHAR(80)  NOT NULL,
       username       VARCHAR(40)  NOT NULL,
       password       TEXT         NOT NULL,
       status         VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
       token_version  INTEGER      NOT NULL DEFAULT 0,
       created_by     INTEGER,
       last_login_at  TIMESTAMPTZ,
       created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS branches_username_lower ON branches (LOWER(username))`, { transaction });
  await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches (id)`, { transaction });
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_users_branch_id ON users (branch_id) WHERE branch_id IS NOT NULL`, { transaction });
  logger?.info('Created branches and users.branch_id');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS branch_id`, { transaction });
  await sequelize.query(`DROP TABLE IF EXISTS branches`, { transaction });
}

module.exports = { up, down };

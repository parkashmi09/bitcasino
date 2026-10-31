'use strict';

/**
 * rainbet: `users.must_change_password`, a password somebody else chose (an upline created the
 * player or reset it). Off for every existing player; it is set from the next create or reset on.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS must_change_password', { transaction });
}

module.exports = { up, down };

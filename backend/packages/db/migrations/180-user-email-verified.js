'use strict';

/**
 * `users.email_verified_at`: when the player proved they read mail at `users.email` (the
 * `verify-email` code, or Google sign-up). NULL for every existing player. Read by the owner's
 * `deposit_email_verification` policy (user-service modules/email/depositGate.js).
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at', { transaction });
}

module.exports = { up, down };

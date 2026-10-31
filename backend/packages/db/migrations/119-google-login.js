'use strict';

/**
 * Google sign-in.
 *
 *   users.google_sub     the Google account (`sub` of the verified ID token) a player signs in
 *                        with. Unique: one Google account, one player.
 *   oauth_login_codes    the one-time code the OAuth callback hands the player site instead of
 *                        tokens in a URL; the site trades it once, within two minutes, for the
 *                        usual token pair. Only a hash is stored.
 *
 * Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64)', { transaction });
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key ON users (google_sub) WHERE google_sub IS NOT NULL', { transaction });
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS oauth_login_codes (
       code_hash  CHAR(64) PRIMARY KEY,
       user_id    BIGINT NOT NULL,
       expires_at TIMESTAMPTZ NOT NULL,
       used_at    TIMESTAMPTZ
     )`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS oauth_login_codes', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS users_google_sub_key', { transaction });
  await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS google_sub', { transaction });
}

module.exports = { up, down };

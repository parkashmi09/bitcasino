'use strict';

/**
 * Where an IP address is, resolved once and reused.
 *
 * `ip_locations` holds one row per address (normalised: IPv4-mapped IPv6 is
 * stored as plain IPv4), filled by the user-service geo resolver
 * (services/user/src/modules/auth/geo/ipLocation.js) from an online provider
 * (ipinfo.io, then ipwho.is) or the offline DB-IP file. A row resolved online
 * in the last 30 days is reused without calling a provider again.
 *
 *   country     ISO 3166-1 alpha-2
 *   region      subdivision code when the provider has one (ipwho.is), else null
 *   region_name subdivision name ("California")
 *   source      which provider answered: ipinfo | ipwhois | local
 *
 * `user_login_history.ip_location_id` points each login at the row that
 * located it, so lat / lon / zip / timezone are one join away.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS ip_locations (
       id          BIGSERIAL PRIMARY KEY,
       address     TEXT         NOT NULL,
       resolved_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       country     VARCHAR(2),
       region      VARCHAR(32),
       region_name VARCHAR(120),
       city        VARCHAR(120),
       zip         VARCHAR(20),
       lat         DOUBLE PRECISION,
       lon         DOUBLE PRECISION,
       timezone    VARCHAR(64),
       source      VARCHAR(16),
       CONSTRAINT ip_locations_address_key UNIQUE (address)
     )`,
    { transaction }
  );

  await sequelize.query(
    `ALTER TABLE user_login_history
       ADD COLUMN IF NOT EXISTS ip_location_id BIGINT REFERENCES ip_locations(id) ON DELETE SET NULL`,
    { transaction }
  );

  logger?.info('Created ip_locations');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE user_login_history DROP COLUMN IF EXISTS ip_location_id', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS ip_locations', { transaction });
}

module.exports = { up, down };

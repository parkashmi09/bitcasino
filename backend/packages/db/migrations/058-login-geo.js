'use strict';

/**
 * Where a player signs in from.
 *
 * `user_login_history` gets one row per successful login or registration,
 * with the IP's location as the geo lookup saw it at that moment (country,
 * region, city, ISP, org, AS, and whether the address is a proxy / hosting
 * range). `users` keeps the latest and the signup location so admin lists can
 * show them without a join.
 *
 * Every column is nullable: a lookup that fails, or a private address, still
 * records the IP and the time.
 */

const GEO = `
  country_code VARCHAR(2),
  country      VARCHAR(80),
  region       VARCHAR(120),
  city         VARCHAR(120),
  isp          VARCHAR(160),
  org          VARCHAR(160),
  asn          VARCHAR(160),
  is_proxy     BOOLEAN,
  is_hosting   BOOLEAN`;

async function up({ sequelize, transaction, logger }) {
  const add = (table, cols) => sequelize.query(
    `ALTER TABLE ${table} ${cols.trim().split(/,\s*\n/).map((c) => `ADD COLUMN IF NOT EXISTS ${c.trim()}`).join(', ')}`,
    { transaction }
  );

  await add('user_login_history', `${GEO},
    source VARCHAR(16)`);

  await add('users', `
    last_country_code VARCHAR(2),
    last_country      VARCHAR(80),
    last_city         VARCHAR(120),
    last_isp          VARCHAR(160),
    signup_ip           TEXT,
    signup_country_code VARCHAR(2),
    signup_country      VARCHAR(80),
    signup_city         VARCHAR(120),
    signup_isp          VARCHAR(160)`);

  logger?.info('Added login geo columns');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(
    `ALTER TABLE user_login_history
       DROP COLUMN IF EXISTS country_code, DROP COLUMN IF EXISTS country, DROP COLUMN IF EXISTS region,
       DROP COLUMN IF EXISTS city, DROP COLUMN IF EXISTS isp, DROP COLUMN IF EXISTS org,
       DROP COLUMN IF EXISTS asn, DROP COLUMN IF EXISTS is_proxy, DROP COLUMN IF EXISTS is_hosting,
       DROP COLUMN IF EXISTS source`,
    { transaction }
  );
  await sequelize.query(
    `ALTER TABLE users
       DROP COLUMN IF EXISTS last_country_code, DROP COLUMN IF EXISTS last_country, DROP COLUMN IF EXISTS last_city,
       DROP COLUMN IF EXISTS last_isp, DROP COLUMN IF EXISTS signup_ip, DROP COLUMN IF EXISTS signup_country_code,
       DROP COLUMN IF EXISTS signup_country, DROP COLUMN IF EXISTS signup_city, DROP COLUMN IF EXISTS signup_isp`,
    { transaction }
  );
}

module.exports = { up, down };

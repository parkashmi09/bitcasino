'use strict';

/**
 * Registration origin, completed, and one spelling per client address.
 *
 * 1. `users.signup_region` — the signup row had country, city and ISP but not
 *    the region the lookup already returns (`region_name`).
 *
 * 2. IPv4-mapped IPv6 (`::ffff:1.2.3.4`) rewritten to `1.2.3.4`. Node reports
 *    an IPv4 client on a dual-stack socket in the mapped form; the auth
 *    service stored it raw, so one player on one address counted as two
 *    "distinct IPs" (multiple-IP flag) and missed every shared-IP match against
 *    the plain form. The service normalises at write time now; this cleans the
 *    rows written before. Only the exact mapped-IPv4 shape is touched.
 */
const MAPPED = `'^::ffff:(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})$'`;

async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_region VARCHAR(120)', { transaction });

  const fix = async (table, column) => {
    const [, meta] = await sequelize.query(
      `UPDATE ${table} SET ${column} = regexp_replace(${column}, ${MAPPED}, '\\1')
        WHERE ${column} ~ ${MAPPED}`,
      { transaction }
    );
    return meta?.rowCount ?? 0;
  };

  const rows = {
    user_login_history: await fix('user_login_history', 'ip_address'),
    users_last_ip: await fix('users', 'last_ip'),
    users_signup_ip: await fix('users', 'signup_ip'),
  };
  logger?.info({ rows }, 'signup_region added, mapped IPv4 addresses normalised');
}

async function down({ sequelize, transaction }) {
  // The address rewrite is not reversed: the mapped form carried no extra information.
  await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS signup_region', { transaction });
}

module.exports = { up, down };

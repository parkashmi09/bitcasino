'use strict';

/**
 * `siteconfig.apaynotificationemail` (site admin → Site Config → Email → "Alerts to") defaulted to
 * a developer's address from the legacy schema, so every new site sent its operator alerts there.
 * hash-game-exchange numbers this 168; here it is 178.
 * No default now: the operator sets the inbox on that page. Existing values are left as they are.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE siteconfig ALTER COLUMN apaynotificationemail DROP DEFAULT', { transaction });
  logger?.info('Dropped the siteconfig.apaynotificationemail default');
}

async function down({ sequelize, transaction }) {
  await sequelize.query("ALTER TABLE siteconfig ALTER COLUMN apaynotificationemail SET DEFAULT 'salvin.dev.cfz@gmail.com'", { transaction });
}

module.exports = { up, down };

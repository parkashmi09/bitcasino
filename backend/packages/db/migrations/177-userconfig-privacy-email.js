'use strict';

/**
 * The player's Settings → Preferences switches that had no column, so they lived in one browser:
 *   hide_gaming_data  — the public profile shows no games played / bets / wins
 *   hide_username     — public lists (race boards) show "Hidden" instead of the username
 *   max_profit_alert  — the max-profit warning before a bet (a client behaviour, stored per account)
 *   deposit_email     — send the "deposit successful" email
 *   withdraw_email    — send the "withdrawal successful" email
 * hash-game-exchange numbers this 167; here it is 177 (167-176 were taken). Same columns, separate from
 * 169-privacy-preferences (show_statistics / show_bets_publicly): either one hides, see profile.service.
 * Defaults are the reference site's: privacy off, the alert and both emails on. No row = defaults.
 */

const COLUMNS = [
  ['hide_gaming_data', false],
  ['hide_username', false],
  ['max_profit_alert', true],
  ['deposit_email', true],
  ['withdraw_email', true],
];

async function up({ sequelize, transaction, logger }) {
  for (const [name, def] of COLUMNS) {
    await sequelize.query(`ALTER TABLE userconfig ADD COLUMN IF NOT EXISTS ${name} BOOLEAN NOT NULL DEFAULT ${def}`, { transaction });
  }
  logger?.info('Added userconfig privacy and email preference columns');
}

async function down({ sequelize, transaction }) {
  for (const [name] of COLUMNS) {
    await sequelize.query(`ALTER TABLE userconfig DROP COLUMN IF EXISTS ${name}`, { transaction });
  }
}

module.exports = { up, down };

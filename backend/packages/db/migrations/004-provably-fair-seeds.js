'use strict';

/**
 * Provably-fair seed storage.
 *
 * Each player holds one active seed pair:
 *   fair_server_seed       — secret until the pair is rotated
 *   fair_server_seed_hash  — published BEFORE any bet (the commitment)
 *   fair_client_seed       — the player's own input, changeable at will
 *   fair_nonce             — round counter, incremented per bet
 *
 * These live on `userconfig` (already keyed by uid, one row per player) rather
 * than in a new table — same cardinality, same lifecycle, one fewer join on the
 * hot betting path.
 *
 * The server seed is a secret while it is active: a player who learned it could
 * compute every future round before deciding whether to bet. It is revealed
 * only on rotation, which is what makes past rounds verifiable without making
 * future ones predictable.
 */

async function up({ queryInterface, sequelize, transaction, logger }) {
  const { DataTypes } = require('sequelize');

  const columns = [
    ['fair_server_seed', { type: DataTypes.STRING(64), allowNull: true }],
    ['fair_server_seed_hash', { type: DataTypes.STRING(64), allowNull: true }],
    ['fair_client_seed', { type: DataTypes.STRING(64), allowNull: true }],
    ['fair_nonce', { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 }],
    ['fair_rotated_at', { type: DataTypes.DATE, allowNull: true }],
  ];

  const existing = await queryInterface.describeTable('userconfig');

  for (const [name, definition] of columns) {
    if (existing[name]) {
      logger?.info(`userconfig.${name} already exists — skipping`);
      continue;
    }
    await queryInterface.addColumn('userconfig', name, definition, { transaction });
  }

  // Verification looks a pair up by its published hash.
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_userconfig_fair_hash
       ON userconfig (fair_server_seed_hash)
     WHERE fair_server_seed_hash IS NOT NULL`,
    { transaction }
  );

  logger?.info('Provably-fair seed columns added to userconfig');
}

async function down({ queryInterface, sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_userconfig_fair_hash', { transaction });
  for (const name of [
    'fair_rotated_at',
    'fair_nonce',
    'fair_client_seed',
    'fair_server_seed_hash',
    'fair_server_seed',
  ]) {
    await queryInterface.removeColumn('userconfig', name, { transaction }).catch(() => {});
  }
}

module.exports = { up, down };

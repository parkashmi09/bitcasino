'use strict';

/**
 * Security (B10): record which deposit satisfied a gift-card claim, so one deposit cannot satisfy
 * several cards. `#checkDeposit` excludes a transaction id already recorded on one of this player's
 * claimed cards. Nullable; existing claims keep NULL (they were already granted).
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE user_gift_cards ADD COLUMN IF NOT EXISTS deposit_transaction_id TEXT', {
    transaction,
  });
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_user_gift_cards_deposit_txn ON user_gift_cards (user_id, deposit_transaction_id) WHERE deposit_transaction_id IS NOT NULL',
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_user_gift_cards_deposit_txn', { transaction });
  await sequelize.query('ALTER TABLE user_gift_cards DROP COLUMN IF EXISTS deposit_transaction_id', { transaction });
}

module.exports = { up, down };

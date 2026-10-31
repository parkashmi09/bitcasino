'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 012-psp-callback-log.
// Domain: extended/payments — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * Every payment-provider callback we have received, accepted or not.
 *
 * The unique index on (provider, payload_digest) WHERE accepted is a replay
 * guard the per-transaction idempotency key cannot provide: it stops one
 * captured, correctly-signed payload from being replayed against a different
 * transaction. See the migration for why CricPay in particular needs it.
 *
 * Nothing here is authoritative about money — `credits_ledger` is. This is the
 * record of what the provider TOLD us, which is a different question and the
 * one that matters in a dispute.
 */
class PspCallbackLog extends Model {}

module.exports = (sequelize) => {
  PspCallbackLog.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      provider: { type: DataTypes.STRING(30), allowNull: false, field: 'provider' },
      reference: { type: DataTypes.STRING(255), allowNull: true, field: 'reference' },
      payload_digest: { type: DataTypes.CHAR(64), allowNull: false, field: 'payload_digest' },
      accepted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'accepted' },
      digest_reserved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'digest_reserved' },
      rejection_code: { type: DataTypes.STRING(60), allowNull: true, field: 'rejection_code' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'amount' },
      currency: { type: DataTypes.STRING(10), allowNull: true, field: 'currency' },
      user_id: { type: DataTypes.BIGINT, allowNull: true, field: 'user_id' },
      source_ip: { type: DataTypes.STRING(64), allowNull: true, field: 'source_ip' },
      payload: { type: DataTypes.JSONB, allowNull: true, field: 'payload' },
    },
    {
      sequelize,
      modelName: 'PspCallbackLog',
      tableName: 'psp_callback_log',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return PspCallbackLog;
};

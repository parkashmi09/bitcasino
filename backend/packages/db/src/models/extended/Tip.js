'use strict';

// HAND-WRITTEN model (not generated). Backed by migrations 077 and 080 (request_id).
// Domain: extended — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One peer-to-peer tip. The money moved through the wallet spine; `from_ledger_id` /
 * `to_ledger_id` are its two `credits_ledger` rows (TIP_SENT, TIP_RECEIVED).
 */
class Tip extends Model {}

module.exports = (sequelize) => {
  Tip.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      from_user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'from_user_id' },
      to_user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'to_user_id' },
      currency: { type: DataTypes.STRING(16), allowNull: false, field: 'currency' },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false, field: 'amount' },
      note: { type: DataTypes.STRING(140), allowNull: true, field: 'note' },
      from_ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'from_ledger_id' },
      to_ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'to_ledger_id' },
      /** The client's id for this send (idempotency); unique per sender. */
      request_id: { type: DataTypes.UUID, allowNull: true, field: 'request_id' },
    },
    {
      sequelize,
      modelName: 'Tip',
      tableName: 'tips',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return Tip;
};

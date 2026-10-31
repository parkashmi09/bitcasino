'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 090.
// Domain: extended — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One applied stake reversal (a refund, a rollback, a sports void) — full or partial.
 *
 * `(source, ref, refund_ref)` is unique, so the same provider refund id applied twice is a
 * duplicate. `amount` is in the stake's currency, `usd_amount` what left `userwager`.
 * Written by `wagerActivity.reverse`; see migration 090.
 */
class WagerReversal extends Model {}

module.exports = (sequelize) => {
  WagerReversal.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      source: { type: DataTypes.TEXT, allowNull: false, field: 'source' },
      ref: { type: DataTypes.TEXT, allowNull: false, field: 'ref' },
      /** The provider's id for this refund; NULL for a full reversal sent without one. */
      refund_ref: { type: DataTypes.TEXT, allowNull: true, field: 'refund_ref' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'amount' },
      usd_amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'usd_amount' },
    },
    {
      sequelize,
      modelName: 'WagerReversal',
      tableName: 'wager_reversals',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return WagerReversal;
};

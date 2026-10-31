'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 042.
// Domain: extended/core — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One rakeback accrual — a line behind `users.rakeamount`.
 *
 * Legacy kept only the running total, added to with a bare
 * `rakeamount = rakeamount + $1`. That cannot say where a balance came from,
 * and it cannot tell a retried accrual from a new one.
 *
 * `(source, ref)` is unique, so it can. See migration 042.
 */
class RakebackAccrual extends Model {}

module.exports = (sequelize) => {
  RakebackAccrual.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'amount' },
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'USDT', field: 'currency' },
      /** The integration that accrued it, e.g. `jsgames-v2`. */
      source: { type: DataTypes.STRING(40), allowNull: false, field: 'source' },
      /** That integration's key for what was accrued on — a round id. */
      ref: { type: DataTypes.STRING(190), allowNull: false, field: 'ref' },
      /** Taken back out by a (partial) stake reversal (migration 090); `amount` is what still counts. */
      reversed_amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'reversed_amount' },
    },
    {
      sequelize,
      modelName: 'RakebackAccrual',
      tableName: 'rakeback_accruals',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      /** Append-only: an accrual is a fact, never edited. */
      updatedAt: false,
    }
  );

  return RakebackAccrual;
};

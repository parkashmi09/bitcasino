'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 090.
// Domain: extended — written by sports-service and casino-service, drained by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A `POST /internal/user/wager/reverse` call that failed after its void / refund committed.
 *
 * The caller (sports void after settlement, GIS refund / rollback) writes it instead of
 * losing it; the user-service worker job `wager:reverse-outbox` retries it with backoff
 * (the reverse is idempotent) until `done`, or marks it `failed` after N attempts.
 * `(source, ref, refund_ref)` is unique — `refund_ref` is '' for a full reversal.
 */
class WagerReverseOutbox extends Model {}

module.exports = (sequelize) => {
  WagerReverseOutbox.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      /** Which service enqueued it: `sports` | `casino`. */
      origin: { type: DataTypes.TEXT, allowNull: false, field: 'origin' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      source: { type: DataTypes.TEXT, allowNull: false, field: 'source' },
      ref: { type: DataTypes.TEXT, allowNull: false, field: 'ref' },
      /** Partial refund in the stake's currency; NULL = reverse in full. */
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'amount' },
      refund_ref: { type: DataTypes.TEXT, allowNull: false, defaultValue: '', field: 'refund_ref' },
      /** `pending` | `done` | `failed`. */
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'pending', field: 'status' },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'attempts' },
      next_attempt_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'next_attempt_at' },
      last_error: { type: DataTypes.TEXT, allowNull: true, field: 'last_error' },
      done_at: { type: DataTypes.DATE, allowNull: true, field: 'done_at' },
    },
    {
      sequelize,
      modelName: 'WagerReverseOutbox',
      tableName: 'wager_reverse_outbox',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return WagerReverseOutbox;
};

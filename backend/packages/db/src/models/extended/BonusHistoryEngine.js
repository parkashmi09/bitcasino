'use strict';

// HAND-WRITTEN model (not generated).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * `bonus_history` — the bonus engine's own ledger.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * TWO TABLES, ONE LETTER APART, AND ONLY ONE HAD A MODEL
 *
 *     bonushistory    the platform's bonus records   → model `Bonushistory`
 *     bonus_history   the bonus ENGINE's records     → nothing
 *
 * `legacy/bonus/bonusengine.js` writes and reads the underscored one; the rest
 * of the platform uses the other. They are different tables with different
 * columns, and the model generator only ever saw the first — which is why
 * `getUserBonusTimers` is raw SQL in the legacy source and stayed unported
 * until now.
 *
 * Named `BonusHistoryEngine` rather than `BonusHistory`, because on a
 * case-insensitive filesystem — which is the default on macOS, where this port
 * was written — `BonusHistory.js` and `Bonushistory.js` are the SAME FILE.
 * `models/core/index.js` lists both names and both resolve to one module. A
 * model file here called `BonusHistory.js` would silently collide with it.
 * ═════════════════════════════════════════════════════════════════════════
 */
class BonusHistoryEngine extends Model {}

module.exports = (sequelize) => {
  BonusHistoryEngine.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      userid: { type: DataTypes.BIGINT, allowNull: true, field: 'userid' },
      bonus_type: { type: DataTypes.STRING, allowNull: true, field: 'bonus_type' },
      bonus_amount: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'bonus_amount' },
      wager_change: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'wager_change' },
      /** After this, the bonus can no longer be claimed. */
      claim_deadline: { type: DataTypes.DATE, allowNull: true, field: 'claim_deadline' },
      is_claimed: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'is_claimed' },
      /**
       * Set by the engine when a bonus was generated but the player did not
       * meet its conditions. Distinct from `is_claimed` — an unclaimable bonus
       * was never available, a claimed one was taken.
       */
      is_unclaimable: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'is_unclaimable' },
      claimed_at: { type: DataTypes.DATE, allowNull: true, field: 'claimed_at' },
      created_at: { type: DataTypes.DATE, allowNull: true, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'BonusHistoryEngine',
      tableName: 'bonus_history',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return BonusHistoryEngine;
};

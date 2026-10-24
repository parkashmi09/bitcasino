'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 076.
// Domain: extended — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One granted bonus. The player's bonus balance is the sum of their `active` rows per currency;
 * the money reaches the cash wallet only when `wagered >= required_wager` (status `completed`).
 * See migration 076 and `services/user/src/modules/player-bonuses`.
 */
class PlayerBonus extends Model {}

module.exports = (sequelize) => {
  PlayerBonus.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      /** first_deposit | spin_wheel */
      source: { type: DataTypes.STRING(40), allowNull: false, field: 'source' },
      /** Unique: makes the grant exactly-once. */
      grant_key: { type: DataTypes.STRING(190), allowNull: false, field: 'grant_key' },
      /** The deposit / claim it came from. */
      ref: { type: DataTypes.STRING(120), allowNull: true, field: 'ref' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'amount' },
      currency: { type: DataTypes.STRING(20), allowNull: false, field: 'currency' },
      wager_multiplier: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, field: 'wager_multiplier' },
      required_wager: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: 0, field: 'required_wager' },
      wagered: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: 0, field: 'wagered' },
      /** Migration 136: 'rollover' or 'gradual' (hash.game — `wagered` is then the amount unlocked). */
      unlock_mode: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'rollover', field: 'unlock_mode' },
      unlock_rate: { type: DataTypes.DECIMAL(10, 6), allowNull: true, field: 'unlock_rate' },
      claimed_amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: 0, field: 'claimed_amount' },
      /** active | completed | expired | forfeited */
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', field: 'status' },
      expires_at: { type: DataTypes.DATE, allowNull: true, field: 'expires_at' },
      granted_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'granted_at' },
      completed_at: { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
      ended_at: { type: DataTypes.DATE, allowNull: true, field: 'ended_at' },
      end_reason: { type: DataTypes.STRING(60), allowNull: true, field: 'end_reason' },
      /** Staff id of a manual forfeit. */
      ended_by: { type: DataTypes.BIGINT, allowNull: true, field: 'ended_by' },
      /** The cash credit on completion. */
      release_ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'release_ledger_id' },
      description: { type: DataTypes.TEXT, allowNull: true, field: 'description' },
    },
    {
      sequelize,
      modelName: 'PlayerBonus',
      tableName: 'player_bonuses',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      timestamps: false,
    }
  );

  return PlayerBonus;
};

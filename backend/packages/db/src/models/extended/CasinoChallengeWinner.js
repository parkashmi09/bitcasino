'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 166 (rainbet).
// Domain: extended — written and read by casino-service.

const { Model, DataTypes } = require('sequelize');

/** One challenge won — see migration 166. */
class CasinoChallengeWinner extends Model {}

module.exports = (sequelize) => {
  CasinoChallengeWinner.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      challenge_id: { type: DataTypes.BIGINT, allowNull: false, field: 'challenge_id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      bet_id: { type: DataTypes.STRING(64), allowNull: false, field: 'bet_id' },
      multiplier: { type: DataTypes.DECIMAL(20, 4), allowNull: false, field: 'multiplier' },
      bet_usd: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: 'bet_usd' },
      currency: { type: DataTypes.STRING(20), allowNull: true, field: 'currency' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'amount' },
      ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'ledger_id' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'CasinoChallengeWinner',
      tableName: 'casino_challenge_winners',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return CasinoChallengeWinner;
};

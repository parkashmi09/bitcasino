'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class UnlockedRewards extends Model {}

module.exports = (sequelize) => {
  UnlockedRewards.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    uid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "uid",
    },
    ownername: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "ownername",
    },
    membername: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "membername",
    },
    referalCode: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "referalCode",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    cointype: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "sbc",
      field: "cointype",
    },
    wager_amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "wager_amount",
    },
    claimed: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "claimed",
    },
  }, {
    sequelize,
    modelName: "UnlockedRewards",
    tableName: "unlocked_rewards",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: false,
  });

  return UnlockedRewards;
};

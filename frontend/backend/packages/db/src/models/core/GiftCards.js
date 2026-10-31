'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class GiftCards extends Model {}

module.exports = (sequelize) => {
  GiftCards.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    unique_key: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "gift_cards_unique_key_key",
      field: "unique_key",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "description",
    },
    period_days: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "period_days",
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: "end_date",
    },
    deposit_status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "deposit_status",
    },
    deposit_amount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      field: "deposit_amount",
    },
    wager_status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "wager_status",
    },
    wager_times: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "wager_times",
    },
    all_user_status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "all_user_status",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
    },
    amount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      field: "amount",
    },
  }, {
    sequelize,
    modelName: "GiftCards",
    tableName: "gift_cards",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return GiftCards;
};

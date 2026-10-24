'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class SpinWheelClaims extends Model {}

module.exports = (sequelize) => {
  SpinWheelClaims.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "user_id",
    },
    deposit_amount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      field: "deposit_amount",
    },
    reward_amount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      field: "reward_amount",
    },
    claimed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "claimed_at",
    },
    slice_label: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "slice_label",
    },
    redeem_code: {
      type: DataTypes.STRING(10),
      allowNull: true,
      field: "redeem_code",
    },
  }, {
    sequelize,
    modelName: "SpinWheelClaims",
    tableName: "spin_wheel_claims",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
    indexes: [
      {
        name: "idx_swc_user",
        fields: ["user_id"],
      },
    ],
  });

  return SpinWheelClaims;
};

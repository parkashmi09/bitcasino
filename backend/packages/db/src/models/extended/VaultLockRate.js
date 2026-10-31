'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class VaultLockRate extends Model {}

module.exports = (sequelize) => {
  VaultLockRate.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    lock_period: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "lock_period",
    },
    label: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "label",
    },
    days: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "days",
    },
    rate: {
      type: DataTypes.DECIMAL(10,4),
      allowNull: true,
      field: "rate",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      field: "is_active",
    },
    early_penalty_rate: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true,
      field: 'early_penalty_rate',
    },
    allow_early_withdrawal: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      field: 'allow_early_withdrawal',
    },
  }, {
    sequelize,
    modelName: "VaultLockRate",
    tableName: "vault_lock_rates",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  });

  return VaultLockRate;
};

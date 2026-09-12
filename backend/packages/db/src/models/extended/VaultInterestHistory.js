'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class VaultInterestHistory extends Model {}

module.exports = (sequelize) => {
  VaultInterestHistory.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    userid: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "userid",
    },
    coin: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "coin",
    },
    deposit_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "deposit_id",
    },
    interest: {
      type: DataTypes.DECIMAL(30,8),
      allowNull: true,
      field: "interest",
    },
    rate: {
      type: DataTypes.DECIMAL(10,4),
      allowNull: true,
      field: "rate",
    },
  }, {
    sequelize,
    modelName: "VaultInterestHistory",
    tableName: "vault_interest_history",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: false,
  });

  return VaultInterestHistory;
};

'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class VaultTransaction extends Model {}

module.exports = (sequelize) => {
  VaultTransaction.init({
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
    amount: {
      type: DataTypes.DECIMAL(30,8),
      allowNull: true,
      field: "amount",
    },
    type: {
      type: DataTypes.STRING(30),
      allowNull: true,
      field: "type",
    },
    deposit_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "deposit_id",
    },
  }, {
    sequelize,
    modelName: "VaultTransaction",
    tableName: "vault_transactions",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: false,
  });

  return VaultTransaction;
};

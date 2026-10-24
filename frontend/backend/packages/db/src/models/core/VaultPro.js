'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class VaultPro extends Model {}

module.exports = (sequelize) => {
  VaultPro.init({
    userid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "userid",
    },
    vaultBalance: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "vaultBalance",
    },
    coin: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "coin",
    },
    incomeDate: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "incomeDate",
    },
  }, {
    sequelize,
    modelName: "VaultPro",
    tableName: "vault_pro",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  VaultPro.removeAttribute('id');

  return VaultPro;
};

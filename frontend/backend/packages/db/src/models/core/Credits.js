'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses UNIQUE constraint credits_uid_unique.
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Credits extends Model {}

module.exports = (sequelize) => {
  Credits.init({
    uid: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      unique: "credits_uid_unique",
      field: "uid",
    },
    btc: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "btc",
    },
    eth: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "eth",
    },
    ltc: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "ltc",
    },
    bch: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "bch",
    },
    usdt: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "usdt",
    },
    trx: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "trx",
    },
    doge: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "doge",
    },
    ada: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "ada",
    },
    xrp: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "xrp",
    },
    bnb: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "bnb",
    },
    usdp: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "usdp",
    },
    nexo: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "nexo",
    },
    mkr: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "mkr",
    },
    tusd: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "tusd",
    },
    usdc: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "usdc",
    },
    busd: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "busd",
    },
    nc: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "nc",
    },
    inr: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "inr",
    },
    shib: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "shib",
    },
    matic: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "matic",
    },
    sc: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "sc",
    },
    mvr: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "mvr",
    },
    bjb: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "bjb",
    },
    aed: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "aed",
    },
    npr: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "npr",
    },
    pkr: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "pkr",
    },
    eur: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "eur",
    },
    bdt: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "bdt",
    },
  }, {
    sequelize,
    modelName: "Credits",
    tableName: "credits",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Credits;
};

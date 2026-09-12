'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class Exchangerate extends Model {}

module.exports = (sequelize) => {
  Exchangerate.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      unique: "unique_currency",
      field: "currency",
    },
    usd_rate: {
      type: DataTypes.DECIMAL(24, 8),
      allowNull: false,
      field: "usd_rate",
    },
    last_updated: {
      type: 'TIMESTAMP',
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "last_updated",
    },
  }, {
    sequelize,
    modelName: "Exchangerate",
    tableName: "exchangerate",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
    indexes: [
      {
        name: "idx_currency",
        fields: ["currency"],
      },
    ],
  });

  return Exchangerate;
};

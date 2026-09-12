'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses UNIQUE constraint unique_uid.
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Userwager extends Model {}

module.exports = (sequelize) => {
  Userwager.init({
    uid: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      unique: "unique_uid",
      field: "uid",
    },
    wager: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "wager",
    },
  }, {
    sequelize,
    modelName: "Userwager",
    tableName: "userwager",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
    indexes: [
      {
        name: "idx_userwager_uid",
        fields: ["uid"],
      },
    ],
  });

  return Userwager;
};

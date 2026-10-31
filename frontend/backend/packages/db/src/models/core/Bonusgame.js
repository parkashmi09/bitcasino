'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Bonusgame extends Model {}

module.exports = (sequelize) => {
  Bonusgame.init({
    userid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "userid",
    },
    luckyspin: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "luckyspin",
    },
    dailybonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "dailybonus",
    },
    weeklybonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "weeklybonus",
    },
    monthlybonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "monthlybonus",
    },
    depositbonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "depositbonus",
    },
    rollcompetitionbonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "rollcompetitionbonus",
    },
    createdat: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "createdat",
    },
    updatedat: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "updatedat",
    },
    rakebackbonus: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "rakebackbonus",
    },
  }, {
    sequelize,
    modelName: "Bonusgame",
    tableName: "bonusgame",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Bonusgame.removeAttribute('id');

  return Bonusgame;
};

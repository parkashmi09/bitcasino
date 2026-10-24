'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Cronbonus extends Model {}

module.exports = (sequelize) => {
  Cronbonus.init({
    userid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "userid",
    },
    viplevel: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "viplevel",
    },
    dailybonus: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "dailybonus",
    },
    weeklybonus: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "weeklybonus",
    },
    monthlybonus: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "monthlybonus",
    },
    dailydate: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "dailydate",
    },
    weeklydate: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "weeklydate",
    },
    monthlydate: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "monthlydate",
    },
    dailyclaim: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: "dailyclaim",
    },
    weeklyclaim: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: "weeklyclaim",
    },
    monthlyclaim: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: "monthlyclaim",
    },
    status: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: "status",
    },
  }, {
    sequelize,
    modelName: "Cronbonus",
    tableName: "cronbonus",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Cronbonus.removeAttribute('id');

  return Cronbonus;
};

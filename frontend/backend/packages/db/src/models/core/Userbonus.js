'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses UNIQUE constraint userbonus_userid_unique.
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Userbonus extends Model {}

module.exports = (sequelize) => {
  Userbonus.init({
    userid: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      unique: "userbonus_userid_unique",
      field: "userid",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "name",
    },
    totalbonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "totalbonus",
    },
    vipbonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "vipbonus",
    },
    specialbonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "specialbonus",
    },
    generalbonus: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "generalbonus",
    },
    createdat: {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "createdat",
    },
    updatedat: {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "updatedat",
    },
    joiningbonus: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "joiningbonus",
    },
    dailybonus: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "dailybonus",
    },
    weeklybonus: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "weeklybonus",
    },
    monthlybonus: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "monthlybonus",
    },
    last_daily_reset: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_daily_reset",
    },
    last_weekly_reset: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_weekly_reset",
    },
    last_monthly_reset: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_monthly_reset",
    },
    rakebonus: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "rakebonus",
    },
    actualdailybonus: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: "0",
      field: "actualdailybonus",
    },
    actualweeklybonus: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: "0",
      field: "actualweeklybonus",
    },
    actualmonthlybonus: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: "0",
      field: "actualmonthlybonus",
    },
  }, {
    sequelize,
    modelName: "Userbonus",
    tableName: "userbonus",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Userbonus;
};

'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class Fancymanualsettlement extends Model {}

module.exports = (sequelize) => {
  Fancymanualsettlement.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    match_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "match_id",
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "eventid",
    },
    fancy_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "fancy_name",
    },
    selection: {
      type: DataTypes.STRING(20),
      allowNull: false,
      field: "selection",
    },
    performed_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "performed_by",
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "notes",
    },
    bet_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "bet_id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "user_id",
    },
  }, {
    sequelize,
    modelName: "Fancymanualsettlement",
    tableName: "fancymanualsettlement",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_fancymanual_by_match_event",
        fields: ["match_id", "eventid"],
      },
      {
        name: "fancymanualsettlement_match_id_eventid_fancy_name_bet_id",
        fields: ["match_id", "eventid", "fancy_name", "bet_id"],
        unique: true,
      },
    ],
  });

  return Fancymanualsettlement;
};

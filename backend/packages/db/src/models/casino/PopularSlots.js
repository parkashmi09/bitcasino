'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class PopularSlots extends Model {}

module.exports = (sequelize) => {
  PopularSlots.init({
    key: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "key",
    },
    game_uuids: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "game_uuids",
    },
  }, {
    sequelize,
    modelName: "PopularSlots",
    tableName: "popular_slots",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: false,
    updatedAt: "updated_at",
  });

  return PopularSlots;
};

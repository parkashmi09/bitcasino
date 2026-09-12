'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// Expression indexes (created by SQL, not by Sequelize):
//   gis_prioritized_types_type_uniq UNIQUE (lower(TRIM(BOTH FROM type)))

const { Model, DataTypes } = require('sequelize');

class GisPrioritizedTypes extends Model {}

module.exports = (sequelize) => {
  GisPrioritizedTypes.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    type: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "type",
    },
    game_ids: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "game_ids",
    },
  }, {
    sequelize,
    modelName: "GisPrioritizedTypes",
    tableName: "gis_prioritized_types",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return GisPrioritizedTypes;
};

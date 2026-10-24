'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class PrioritizedGisGameItemsBackup extends Model {}

module.exports = (sequelize) => {
  PrioritizedGisGameItemsBackup.init({
    prioritized_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "prioritized_id",
    },
    uuid: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "uuid",
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "position",
    },
  }, {
    sequelize,
    modelName: "PrioritizedGisGameItemsBackup",
    tableName: "prioritized_gis_game_items_backup",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  PrioritizedGisGameItemsBackup.removeAttribute('id');

  return PrioritizedGisGameItemsBackup;
};

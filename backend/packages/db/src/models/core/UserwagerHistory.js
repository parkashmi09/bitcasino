'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// Foreign keys:
//   uid -> userwager(uid) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class UserwagerHistory extends Model {}

module.exports = (sequelize) => {
  UserwagerHistory.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    uid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "userwager", key: "uid" },
      onDelete: "CASCADE",
      field: "uid",
    },
    previous_wager: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "previous_wager",
    },
    new_wager: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "new_wager",
    },
  }, {
    sequelize,
    modelName: "UserwagerHistory",
    tableName: "userwager_history",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: false,
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_userwager_history_uid_updated_at",
        fields: ["uid", "updated_at"],
      },
    ],
  });

  return UserwagerHistory;
};

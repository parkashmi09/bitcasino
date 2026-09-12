'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses id column (no PRIMARY KEY constraint in the database).
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Apigames extends Model {}

module.exports = (sequelize) => {
  Apigames.init({
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: true,
      field: "id",
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "title",
    },
    platform: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "platform",
    },
    type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "type",
    },
    subtype: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "subtype",
    },
    enabled: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "enabled",
    },
    fun_mode: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "fun_mode",
    },
    campaigns: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "campaigns",
    },
    vendor: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "vendor",
    },
    created_at: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "created_at",
    },
    vendor_groups: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "vendor_groups",
    },
    details_description_en: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "details_description_en",
    },
    details_thumbnails_300x300: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "details_thumbnails_300x300",
    },
  }, {
    sequelize,
    modelName: "Apigames",
    tableName: "apigames",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Apigames;
};

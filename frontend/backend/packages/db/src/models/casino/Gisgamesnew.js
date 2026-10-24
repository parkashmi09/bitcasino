'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class Gisgamesnew extends Model {}

module.exports = (sequelize) => {
  Gisgamesnew.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    uuid: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "gisgamesnew_uuid_key",
      field: "uuid",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "name",
    },
    provider: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "provider",
    },
    provider_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "provider_id",
    },
    type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "type",
    },
    image: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "image",
    },
    technology: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "technology",
    },
    has_lobby: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "has_lobby",
    },
    is_mobile: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "is_mobile",
    },
    has_freespins: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "has_freespins",
    },
    freespin_valid_until_full_day: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "freespin_valid_until_full_day",
    },
    updated_at: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "updated_at",
    },
    label: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "label",
    },
    parameters: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "parameters",
    },
    tags: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "tags",
    },
    images: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "images",
    },
    image3: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "image3",
    },
  }, {
    sequelize,
    modelName: "Gisgamesnew",
    tableName: "gisgamesnew",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_gisgamesnew_provider",
        fields: ["provider"],
      },
    ],
  });

  return Gisgamesnew;
};

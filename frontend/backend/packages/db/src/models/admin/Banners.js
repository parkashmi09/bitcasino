'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)

const { Model, DataTypes } = require('sequelize');

class Banners extends Model {}

module.exports = (sequelize) => {
  Banners.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    type: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "type",
    },
    image: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "image",
    },
  }, {
    sequelize,
    modelName: "Banners",
    tableName: "banners",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return Banners;
};

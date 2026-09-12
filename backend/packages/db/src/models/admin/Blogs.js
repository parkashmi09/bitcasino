'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)

const { Model, DataTypes } = require('sequelize');

class Blogs extends Model {}

module.exports = (sequelize) => {
  Blogs.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    slug: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: "blogs_slug_key",
      field: "slug",
    },
    title: {
      type: DataTypes.STRING(512),
      allowNull: false,
      field: "title",
    },
    subheading: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "subheading",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "description",
    },
    author: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: "Anonymous",
      field: "author",
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "date",
    },
    category: {
      type: DataTypes.STRING(128),
      allowNull: true,
      defaultValue: "Uncategorized",
      field: "category",
    },
    image: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "image",
    },
  }, {
    sequelize,
    modelName: "Blogs",
    tableName: "blogs",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_blogs_category",
        fields: ["category"],
      },
      {
        name: "idx_blogs_created_at",
        fields: ["created_at"],
      },
      {
        name: "idx_blogs_slug",
        fields: ["slug"],
      },
    ],
  });

  return Blogs;
};

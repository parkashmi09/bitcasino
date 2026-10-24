'use strict';

// Hand-written — see packages/db/migrations/047-promotions.js

const { Model, DataTypes } = require('sequelize');

class Promotions extends Model {}

module.exports = (sequelize) => {
  Promotions.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      segment: { type: DataTypes.STRING(20), allowNull: false, field: 'segment' },
      slug: { type: DataTypes.STRING(255), allowNull: false, field: 'slug' },
      title: { type: DataTypes.STRING(512), allowNull: false, field: 'title' },
      summary: { type: DataTypes.TEXT, allowNull: true, field: 'summary' },
      description: { type: DataTypes.TEXT, allowNull: false, field: 'description' },
      terms_html: { type: DataTypes.TEXT, allowNull: true, field: 'terms_html' },
      image_alt: { type: DataTypes.STRING(512), allowNull: true, field: 'image_alt' },
      image: { type: DataTypes.TEXT, allowNull: true, field: 'image' },
      image_data: { type: DataTypes.BLOB, allowNull: true, field: 'image_data' },
      content_type: { type: DataTypes.STRING(60), allowNull: true, field: 'content_type' },
      byte_size: { type: DataTypes.INTEGER, allowNull: true, field: 'byte_size' },
      featured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'featured' },
      promo_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'live', field: 'promo_status' },
      ends_at: { type: DataTypes.DATE, allowNull: true, field: 'ends_at' },
      view_all_href: { type: DataTypes.STRING(512), allowNull: true, field: 'view_all_href' },
      qualifying_games: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'qualifying_games' },
      sport_events: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'sport_events' },
      leaderboard: { type: DataTypes.JSONB, allowNull: true, field: 'leaderboard' },
      tournament_panel: { type: DataTypes.JSONB, allowNull: true, field: 'tournament_panel' },
      tags: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'tags' },
      sidebar_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'sidebar_enabled' },
      sidebar_label: { type: DataTypes.STRING(512), allowNull: true, field: 'sidebar_label' },
      sidebar_icon: { type: DataTypes.STRING(128), allowNull: true, field: 'sidebar_icon' },
      sidebar_counter: { type: DataTypes.STRING(32), allowNull: true, field: 'sidebar_counter' },
      sidebar_sort: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sidebar_sort' },
      is_published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_published' },
      published_at: { type: DataTypes.DATE, allowNull: true, field: 'published_at' },
      created_by: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
      updated_by: { type: DataTypes.BIGINT, allowNull: true, field: 'updated_by' },
    },
    {
      sequelize,
      modelName: 'Promotions',
      tableName: 'promotions',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return Promotions;
};

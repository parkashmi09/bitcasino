'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// Foreign keys:
//   gift_card_id -> gift_cards(id) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class UserGiftCards extends Model {}

module.exports = (sequelize) => {
  UserGiftCards.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "user_id",
    },
    gift_card_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "gift_cards", key: "id" },
      onDelete: "CASCADE",
      field: "gift_card_id",
    },
    start_date: {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "start_date",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "Activated",
      field: "status",
    },
  }, {
    sequelize,
    modelName: "UserGiftCards",
    tableName: "user_gift_cards",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "user_gift_cards_user_id_gift_card_id_key",
        fields: ["user_id", "gift_card_id"],
        unique: true,
      },
    ],
  });

  return UserGiftCards;
};

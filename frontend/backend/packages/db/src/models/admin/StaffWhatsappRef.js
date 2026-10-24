'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)
//
// Foreign keys:
//   staff_id -> staff(id) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class StaffWhatsappRef extends Model {}

module.exports = (sequelize) => {
  StaffWhatsappRef.init({
    staff_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      references: { model: "staff", key: "id" },
      onDelete: "CASCADE",
      field: "staff_id",
    },
    slug: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "staff_whatsapp_ref_slug_key",
      field: "slug",
    },
    phone: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "phone",
    },
  }, {
    sequelize,
    modelName: "StaffWhatsappRef",
    tableName: "staff_whatsapp_ref",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "staff_whatsapp_ref_slug_idx",
        fields: ["slug"],
      },
    ],
  });

  return StaffWhatsappRef;
};

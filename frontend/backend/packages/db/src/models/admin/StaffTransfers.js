'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)

const { Model, DataTypes } = require('sequelize');

class StaffTransfers extends Model {}

module.exports = (sequelize) => {
  StaffTransfers.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    from_type: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "from_type",
    },
    from_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "from_id",
    },
    to_type: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "to_type",
    },
    to_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "to_id",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    direction: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "direction",
    },
    transfer_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "transfer",
      field: "transfer_type",
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "note",
    },
  }, {
    sequelize,
    modelName: "StaffTransfers",
    tableName: "staff_transfers",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_staff_transfers_type",
        fields: ["transfer_type"],
      },
      {
        name: "staff_transfers_from_id_idx",
        fields: ["from_type", "from_id"],
      },
      {
        name: "staff_transfers_to_id_idx",
        fields: ["to_type", "to_id"],
      },
    ],
  });

  return StaffTransfers;
};

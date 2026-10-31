'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class UserKyc extends Model {}

module.exports = (sequelize) => {
  UserKyc.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: "user_kyc_user_id_key",
      field: "user_id",
    },
    first_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "first_name",
    },
    last_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "last_name",
    },
    gender: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "gender",
    },
    date_of_birth: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: "date_of_birth",
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "address",
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "city",
    },
    country: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "country",
    },
    document_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "document_type",
    },
    id_front_path: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "id_front_path",
    },
    id_back_path: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "id_back_path",
    },
    passport_path: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "passport_path",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "Unverified",
      field: "status",
    },
    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "rejection_reason",
    },
  }, {
    sequelize,
    modelName: "UserKyc",
    tableName: "user_kyc",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_user_kyc_user_id",
        fields: ["user_id"],
      },
    ],
  });

  return UserKyc;
};

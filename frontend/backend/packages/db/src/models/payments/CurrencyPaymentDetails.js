'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class CurrencyPaymentDetails extends Model {}

module.exports = (sequelize) => {
  CurrencyPaymentDetails.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    coin_type: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: "coin_type",
    },
    bank_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "bank_name",
    },
    account_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "account_number",
    },
    ifsc_code: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "ifsc_code",
    },
    account_holder_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "account_holder_name",
    },
    qr_image: {
      type: DataTypes.BLOB,
      allowNull: true,
      field: "qr_image",
    },
    upi_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "upi_id",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "is_active",
    },
  }, {
    sequelize,
    modelName: "CurrencyPaymentDetails",
    tableName: "currency_payment_details",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_currency_payment_details_coin_type",
        fields: ["coin_type"],
      },
    ],
  });

  return CurrencyPaymentDetails;
};

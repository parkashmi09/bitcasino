'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 153-payment-methods.
// Domain: extended/payments — read by user-service, written by admin-service.

const { Model, DataTypes } = require('sequelize');

/** One deposit method of a gateway in one currency, with the owner's and the Super Admin's switch. */
class PaymentMethod extends Model {}

module.exports = (sequelize) => {
  PaymentMethod.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      gateway: { type: DataTypes.STRING(30), allowNull: false, field: 'gateway' },
      currency: { type: DataTypes.STRING(10), allowNull: false, field: 'currency' },
      code: { type: DataTypes.STRING(40), allowNull: false, field: 'code' },
      owner_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'owner_enabled' },
      site_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'site_enabled' },
      added_by: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'site', field: 'added_by' },
      updated_by: { type: DataTypes.STRING(190), allowNull: true, field: 'updated_by' },
    },
    {
      sequelize,
      modelName: 'PaymentMethod',
      tableName: 'payment_methods',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return PaymentMethod;
};

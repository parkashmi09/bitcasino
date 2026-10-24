'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class P2pPaymentType extends Model {}

module.exports = (sequelize) => {
  P2pPaymentType.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "name",
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "code",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      field: "is_active",
    },
  }, {
    sequelize,
    modelName: "P2pPaymentType",
    tableName: "p2p_payment_types",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return P2pPaymentType;
};

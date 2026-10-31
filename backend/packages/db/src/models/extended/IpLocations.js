'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 064-ip-locations.
// Domain: extended — owned by user-service (geo resolver in modules/auth/geo).

const { Model, DataTypes } = require('sequelize');

/** Where an IP address is: one row per normalised address, reused for 30 days. */
class IpLocations extends Model {}

module.exports = (sequelize) => {
  IpLocations.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      address: { type: DataTypes.TEXT, allowNull: false, unique: true, field: 'address' },
      resolved_at: { type: DataTypes.DATE, allowNull: false, field: 'resolved_at' },
      country: { type: DataTypes.STRING(2), allowNull: true, field: 'country' },
      region: { type: DataTypes.STRING(32), allowNull: true, field: 'region' },
      region_name: { type: DataTypes.STRING(120), allowNull: true, field: 'region_name' },
      city: { type: DataTypes.STRING(120), allowNull: true, field: 'city' },
      zip: { type: DataTypes.STRING(20), allowNull: true, field: 'zip' },
      lat: { type: DataTypes.DOUBLE, allowNull: true, field: 'lat' },
      lon: { type: DataTypes.DOUBLE, allowNull: true, field: 'lon' },
      timezone: { type: DataTypes.STRING(64), allowNull: true, field: 'timezone' },
      source: { type: DataTypes.STRING(16), allowNull: true, field: 'source' },
    },
    {
      sequelize,
      modelName: 'IpLocations',
      tableName: 'ip_locations',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return IpLocations;
};

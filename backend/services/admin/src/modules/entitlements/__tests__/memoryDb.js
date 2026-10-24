'use strict';

/**
 * Just enough of the connection for `createEntitlementsStore` without a database:
 * `owner_entitlements` / `owner_audit` as arrays, the version PK enforced like Postgres.
 * The real table is covered by ownerApi.test.js.
 */
function memoryDb() {
  const rows = [];
  const audit = [];
  return {
    rows,
    audit,
    sequelize: { transaction: async (fn) => fn(null) },
    models: {
      OwnerEntitlement: {
        findOne: async () => (rows.length ? { ...rows.reduce((a, b) => (a.version > b.version ? a : b)) } : null),
        create: async (row) => {
          if (rows.some((r) => r.version === row.version)) {
            const error = new Error('duplicate key');
            error.name = 'SequelizeUniqueConstraintError';
            throw error;
          }
          rows.push({ ...row, created_at: new Date() });
        },
      },
      OwnerAudit: {
        create: async (row) => audit.push({ id: audit.length + 1, ...row }),
        findAll: async ({ limit }) => audit.slice().reverse().slice(0, limit),
      },
    },
  };
}

module.exports = { memoryDb };

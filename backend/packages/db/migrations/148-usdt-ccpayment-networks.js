'use strict';

/**
 * USDT on every network CCPayment takes it on (user, 2026-10-21): TRC20 / ERC20 / BEP20 were
 * seeded by 061; Solana, Polygon, TON, Arbitrum, OP Mainnet and opBNB join them, switched on.
 * Keys that exist keep their name and switch. Idempotent; the owner (`flags["usdt:<key>"]`) and
 * the site admin (Coins) switch each one.
 */
const ADDED = [
  { key: 'SOL', name: 'Solana' },
  { key: 'POLYGON', name: 'Polygon' },
  { key: 'TON', name: 'TON' },
  { key: 'ARETH', name: 'Arbitrum One' },
  { key: 'OPTIMISM', name: 'OP Mainnet' },
  { key: 'OPBNB', name: 'opBNB' },
];

async function readNetworks(sequelize, transaction) {
  const [rows] = await sequelize.query("SELECT networks FROM currencies WHERE code = 'USDT'", { transaction });
  return rows.length ? (Array.isArray(rows[0].networks) ? rows[0].networks : []) : null;
}

async function write(sequelize, transaction, networks) {
  await sequelize.query("UPDATE currencies SET networks = CAST(:networks AS jsonb) WHERE code = 'USDT'", {
    replacements: { networks: JSON.stringify(networks) },
    transaction,
  });
}

async function up({ sequelize, transaction }) {
  const current = await readNetworks(sequelize, transaction);
  if (!current) return;
  const missing = ADDED.filter((n) => !current.some((c) => c.key === n.key)).map((n) => ({ ...n, enabled: true }));
  if (missing.length) await write(sequelize, transaction, [...current, ...missing]);
}

async function down({ sequelize, transaction }) {
  const current = await readNetworks(sequelize, transaction);
  if (!current) return;
  await write(sequelize, transaction, current.filter((c) => !ADDED.some((n) => n.key === c.key)));
}

module.exports = { up, down };

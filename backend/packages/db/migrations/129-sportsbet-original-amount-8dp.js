'use strict';

/**
 * `mssports."SportsBet".original_amount` to 8 decimals (user, 2026-10-18): a bet's money moves in
 * its own coin and a return is worked out from original_amount / stake_amount, so a BTC stake
 * (0.015) must not be stored as 0.02. Widening keeps every stored value. The Adminer view of the
 * table (128) blocks the type change, so it is dropped and made again around it.
 */
async function retype(sequelize, transaction, type) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('DROP VIEW IF EXISTS public."ms_SportsBet"');
  await q(`ALTER TABLE mssports."SportsBet" ALTER COLUMN original_amount TYPE ${type}`);
  await q('CREATE VIEW public."ms_SportsBet" AS SELECT * FROM mssports."SportsBet"');
}

async function up({ sequelize, transaction }) {
  await retype(sequelize, transaction, 'NUMERIC(24, 8)');
}

async function down({ sequelize, transaction }) {
  await retype(sequelize, transaction, 'NUMERIC(15, 2)');
}

module.exports = { up, down };

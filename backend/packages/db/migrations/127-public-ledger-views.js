'use strict';

/**
 * The sportsbook ledgers live in the `mssports` schema, so Adminer's default `public` list never
 * showed them (user, 2026-10-18). Read-through views in `public` make them show up there; the
 * tables, and every writer, stay in `mssports`. `public.credits_ledger` already exists (the main
 * wallet one), so the sports one is `public.sports_credits_ledger`.
 * shortcut: a view freezes its column list, re-run this (down + up) after adding a column to one of these tables.
 */
const VIEWS = {
  point_ledger: 'point_ledger',
  point_ledger_direct: 'point_ledger_direct',
  debit_ledger: 'debit_ledger',
  sports_credits_ledger: 'credits_ledger',
};

async function up({ sequelize, transaction }) {
  for (const [view, table] of Object.entries(VIEWS)) {
    await sequelize.query(`CREATE OR REPLACE VIEW public.${view} AS SELECT * FROM mssports.${table}`, { transaction });
  }
}

async function down({ sequelize, transaction }) {
  for (const view of Object.keys(VIEWS)) {
    await sequelize.query(`DROP VIEW IF EXISTS public.${view}`, { transaction });
  }
}

module.exports = { up, down };

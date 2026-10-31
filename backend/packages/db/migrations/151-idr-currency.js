'use strict';

/**
 * IDR (Indonesian Rupiah) as a built-in wallet currency (user, 2026-10-24: F2Pay's Indonesian
 * methods — QRIS, DANA, the banks — are paid in IDR, so a player deposits and holds IDR).
 *
 *   credits.idr        the balance column, like every built-in fiat (NUMERIC, default 0)
 *   currencies 'IDR'   builtin fiat; site_enabled FALSE so no player sees it until the site admin
 *                      switches it on (Finance → Coins) — the owner's `flags.idr` applies too
 *   exchangerate 'IDR' its USD value for reports / VIP / bonuses (never for an F2Pay order, which
 *                      is paid in the currency deposited). Seeded with open.er-api's rate on
 *                      2026-10-24 (18,090 IDR per USD); the hourly refresh keeps it current.
 *   direct_ledger_credits  migration 117's trigger with `idr` in its column list, so an IDR move
 *                      of a direct user lands in point_ledger_direct like any other.
 *
 * Idempotent.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MONEY_COLUMNS = [
  'btc', 'eth', 'ltc', 'bch', 'usdt', 'trx', 'doge', 'ada', 'xrp', 'bnb', 'usdp', 'nexo', 'mkr', 'tusd',
  'usdc', 'busd', 'nc', 'inr', 'shib', 'matic', 'sc', 'mvr', 'bjb', 'aed', 'npr', 'pkr', 'eur', 'bdt',
];

/** Migration 117's function body, over `columns`. */
const ledgerFunction = (columns) => `
  CREATE OR REPLACE FUNCTION mssports.direct_ledger_credits() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE
    o JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
    n JSONB := to_jsonb(NEW);
    c TEXT;
    ov NUMERIC;
    nv NUMERIC;
    wrote BOOLEAN := FALSE;
  BEGIN
    IF NEW.uid IS NULL OR NEW.staff_id IS NOT NULL THEN RETURN NEW; END IF;
    FOREACH c IN ARRAY ARRAY['${columns.join("','")}'] LOOP
      nv := COALESCE((n->>c)::numeric, 0);
      ov := COALESCE((o->>c)::numeric, 0);
      IF nv <> ov THEN
        PERFORM mssports.direct_ledger_write(NEW.uid, c, nv - ov, nv);
        wrote := TRUE;
      END IF;
    END LOOP;
    IF wrote THEN PERFORM set_config('parker.ledger', '', true); END IF;
    RETURN NEW;
  END $$`;

function seedImage() {
  const data = fs.readFileSync(path.join(__dirname, '..', 'assets', 'coins', 'idr.svg'));
  const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
  return { data, contentType: 'image/svg+xml', byteSize: data.length, asset: `idr-${hash}.svg` };
}

async function up({ sequelize, transaction }) {
  const q = (sql, replacements) => sequelize.query(sql, { transaction, replacements });

  await q("ALTER TABLE credits ADD COLUMN IF NOT EXISTS idr NUMERIC DEFAULT '0'::numeric");
  await q(
    `INSERT INTO currencies
       (code, kind, decimals, builtin, owner_enabled, site_enabled, name, symbol, sort_order,
        image_asset, image_data, image_content_type, image_byte_size, networks, retired, updated_by)
     VALUES
       ('IDR', 'fiat', 2, true, true, false, 'Indonesian Rupiah', 'Rp', 270,
        :asset, :data, :contentType, :byteSize, '[]'::jsonb, false, 'migration:151')
     ON CONFLICT (code) DO NOTHING`,
    seedImage()
  );
  await q(
    `INSERT INTO exchangerate (currency, usd_rate, last_updated)
     SELECT 'IDR', 0.00005528, now()
      WHERE NOT EXISTS (SELECT 1 FROM exchangerate WHERE UPPER(currency) = 'IDR')`
  );
  await q(ledgerFunction([...MONEY_COLUMNS, 'idr']));
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(ledgerFunction(MONEY_COLUMNS));
  await q("DELETE FROM exchangerate WHERE currency = 'IDR'");
  // Only while nothing holds or moved IDR (the registry row is referenced by nothing else).
  await q("DELETE FROM currencies WHERE code = 'IDR'");
  await q('ALTER TABLE credits DROP COLUMN IF EXISTS idr');
}

module.exports = { up, down };

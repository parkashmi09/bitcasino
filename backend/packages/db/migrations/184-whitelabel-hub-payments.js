'use strict';

/**
 * Gateway payments for whitelabel copies, run through the parent (common/hubAuth,
 * docs/plans/2026-11-01-whitelabel-plan-and-casino-hub.md Part C). Created on every site;
 * the parent writes the first three, a copy the last two.
 *
 *   whitelabels.hub_key / hub_secret   the copy's API key and its secret (sealed)
 *   whitelabel_gateway_orders          parent: every gateway order a copy opened on the parent's
 *                                      account, its charge rate and whether its outcome reached the copy
 *   whitelabel_settings.hub            copy: { url, key, secret (sealed) } the parent pushed
 *   whitelabel_gateway_movements       copy: each company-balance movement a gateway payment made
 *                                      (one per order and kind — retries never move twice)
 */

async function up({ sequelize, transaction, logger }) {
  const q = (sql) => sequelize.query(sql, { transaction });

  await q(`ALTER TABLE whitelabels ADD COLUMN IF NOT EXISTS hub_key VARCHAR(40)`);
  await q(`ALTER TABLE whitelabels ADD COLUMN IF NOT EXISTS hub_secret TEXT`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS whitelabels_hub_key ON whitelabels (hub_key) WHERE hub_key IS NOT NULL`);

  await q(
    `CREATE TABLE IF NOT EXISTS whitelabel_gateway_orders (
       id                BIGSERIAL     PRIMARY KEY,
       whitelabel_id     INTEGER       NOT NULL REFERENCES whitelabels (id),
       provider          VARCHAR(20)   NOT NULL,
       flow              VARCHAR(10)   NOT NULL CHECK (flow IN ('deposit', 'payout')),
       reference         VARCHAR(64)   NOT NULL,
       copy_reference    VARCHAR(64)   NOT NULL,
       currency          VARCHAR(10)   NOT NULL,
       amount            NUMERIC(30,8) NOT NULL CHECK (amount > 0),
       charge_pct        NUMERIC(6,2)  NOT NULL DEFAULT 0,
       status            VARCHAR(10)   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
       provider_reference VARCHAR(128),
       utr               VARCHAR(64),
       delivered         BOOLEAN       NOT NULL DEFAULT false,
       delivery_attempts INTEGER       NOT NULL DEFAULT 0,
       delivery_error    TEXT,
       created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
     )`
  );
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS whitelabel_gateway_orders_ref ON whitelabel_gateway_orders (provider, reference)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS whitelabel_gateway_orders_copy_ref ON whitelabel_gateway_orders (whitelabel_id, flow, copy_reference)`);
  await q(`CREATE INDEX IF NOT EXISTS whitelabel_gateway_orders_undelivered ON whitelabel_gateway_orders (id) WHERE status <> 'pending' AND delivered = false`);
  await q(`CREATE INDEX IF NOT EXISTS whitelabel_gateway_orders_wl ON whitelabel_gateway_orders (whitelabel_id, created_at DESC)`);

  await q(`ALTER TABLE whitelabel_settings ADD COLUMN IF NOT EXISTS hub JSONB`);

  await q(
    `CREATE TABLE IF NOT EXISTS whitelabel_gateway_movements (
       provider     VARCHAR(20)   NOT NULL,
       reference    VARCHAR(64)   NOT NULL,
       kind         VARCHAR(20)   NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'withdrawal_refund')),
       currency     VARCHAR(10)   NOT NULL,
       amount       NUMERIC(30,8) NOT NULL,
       amount_inr   NUMERIC(20,8) NOT NULL,
       charge_pct   NUMERIC(6,2)  NOT NULL,
       charge_inr   NUMERIC(20,8) NOT NULL,
       staff_id     INTEGER       NOT NULL,
       created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
       PRIMARY KEY (provider, reference, kind)
     )`
  );
  logger?.info('Created whitelabel hub key columns, whitelabel_gateway_orders and whitelabel_gateway_movements');
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(`DROP TABLE IF EXISTS whitelabel_gateway_movements`);
  await q(`ALTER TABLE whitelabel_settings DROP COLUMN IF EXISTS hub`);
  await q(`DROP TABLE IF EXISTS whitelabel_gateway_orders`);
  await q(`DROP INDEX IF EXISTS whitelabels_hub_key`);
  await q(`ALTER TABLE whitelabels DROP COLUMN IF EXISTS hub_secret`);
  await q(`ALTER TABLE whitelabels DROP COLUMN IF EXISTS hub_key`);
}

module.exports = { up, down };

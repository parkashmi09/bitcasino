'use strict';

/**
 * The peer-to-peer trading schema.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RECONSTRUCTED, NOT DUMPED — read this before trusting it.
 *
 * `legacy/peerTrade/` queries eight tables. None of them exist in
 * `000_baseline_schema.sql`, and none exist in either live database that was
 * available (`ibitplay` and `ibitplay_test`, identical 132-table sets). Only
 * `p2p_disputes` shipped with DDL, in `legacy/peerTrade/disputes_table.sql`.
 *
 * So seven of these tables are reconstructed from the INSERT column lists,
 * UPDATE SET clauses and SELECT aliases in `controler.js`. That recovers the
 * column NAMES reliably — they are written out in the queries — but the types,
 * nullability, defaults and constraints are inferred from how each column is
 * used. Where the legacy code gave no signal, the choice made here is the
 * conservative one:
 *
 *   - money is NUMERIC(30,8), matching the rest of the platform, never float
 *   - identifiers that legacy compared against `users.id` as text are VARCHAR,
 *     because that is what the legacy comparisons imply
 *   - foreign keys are declared where the relationship is unambiguous
 *   - `created_at` defaults to NOW() everywhere, since every listing orders by it
 *
 * `p2p_disputes` follows the shipped DDL exactly, including its choices that
 * differ from the above (`order_id INTEGER`, `user_id VARCHAR(100)`).
 *
 * If a production database with the real tables turns up, DIFF IT AGAINST THIS
 * before running the module in anger. A reconstructed money schema that is
 * subtly wrong is worse than no schema, because it will accept writes.
 * ─────────────────────────────────────────────────────────────────────────
 */

async function up({ sequelize, transaction, logger }) {
  // ── Payment types: the rails an offer can settle over (UPI, IMPS, …) ──
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS p2p_payment_types (
       id          SERIAL PRIMARY KEY,
       name        VARCHAR(100) NOT NULL,
       code        VARCHAR(50)  NOT NULL UNIQUE,
       is_active   BOOLEAN      NOT NULL DEFAULT true,
       created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  // ── The house's own accounts, per payment type ───────────────────────
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS p2p_payment_accounts (
       id               SERIAL PRIMARY KEY,
       payment_type_id  INTEGER NOT NULL REFERENCES p2p_payment_types(id) ON DELETE RESTRICT,
       account_name     VARCHAR(255),
       account_number   VARCHAR(100),
       ifsc_code        VARCHAR(50),
       upi_id           VARCHAR(255),
       -- BYTEA: the legacy handler stored the uploaded file itself, as
       -- currency_payment_details.qr_image does.
       qr_image         BYTEA,
       extra_details    JSONB,
       is_active        BOOLEAN     NOT NULL DEFAULT true,
       created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  // ── Offers: what the house will buy or sell, and at what price ───────
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS p2p_offers (
       id                SERIAL PRIMARY KEY,
       coin              VARCHAR(20)  NOT NULL,
       fiat              VARCHAR(20)  NOT NULL,
       -- 'BUY' or 'SELL' from the PLAYER's point of view.
       segment           VARCHAR(10)  NOT NULL DEFAULT 'BUY',
       price             NUMERIC(30,8) NOT NULL,
       available_amount  NUMERIC(30,8) NOT NULL DEFAULT 0,
       min_limit         NUMERIC(30,8),
       max_limit         NUMERIC(30,8),
       -- Minutes a buyer has to pay before the order expires.
       payment_time      INTEGER      NOT NULL DEFAULT 15,
       username          VARCHAR(255),
       avatar_letter     VARCHAR(4),
       is_verified       BOOLEAN      NOT NULL DEFAULT false,
       is_kyc_verified   BOOLEAN      NOT NULL DEFAULT false,
       is_featured       BOOLEAN      NOT NULL DEFAULT false,
       status            VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
       created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  // Which of the house's accounts an offer will settle over. Many-to-many.
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS p2p_offer_payments (
       id                  SERIAL PRIMARY KEY,
       offer_id            INTEGER NOT NULL REFERENCES p2p_offers(id) ON DELETE CASCADE,
       payment_account_id  INTEGER NOT NULL REFERENCES p2p_payment_accounts(id) ON DELETE RESTRICT,
       UNIQUE (offer_id, payment_account_id)
     )`,
    { transaction }
  );

  // ── Buy orders: the player is buying crypto, paying fiat ─────────────
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS p2p_orders (
       id                  SERIAL PRIMARY KEY,
       order_no            VARCHAR(50)  NOT NULL UNIQUE,
       -- VARCHAR because the legacy queries compare it against users.id as
       -- text, exactly as credits_ledger.user_id does.
       user_id             VARCHAR(100) NOT NULL,
       offer_id            INTEGER      REFERENCES p2p_offers(id) ON DELETE SET NULL,
       payment_account_id  INTEGER      REFERENCES p2p_payment_accounts(id) ON DELETE SET NULL,
       coin                VARCHAR(20)  NOT NULL,
       fiat                VARCHAR(20)  NOT NULL,
       price               NUMERIC(30,8) NOT NULL,
       crypto_amount       NUMERIC(30,8) NOT NULL,
       fiat_amount         NUMERIC(30,8) NOT NULL,
       utr_number          VARCHAR(100),
       payment_proof       VARCHAR(255),
       status              VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
       expires_at          TIMESTAMPTZ,
       paid_at             TIMESTAMPTZ,
       released_at         TIMESTAMPTZ,
       created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  // ── Sell orders: the player is selling crypto, receiving fiat ────────
  // A separate table in legacy rather than a flag on p2p_orders, because the
  // fields differ — a sell order carries the PLAYER's bank details, a buy order
  // carries the house's.
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS p2p_orders_sell (
       id               SERIAL PRIMARY KEY,
       order_no         VARCHAR(50)  NOT NULL UNIQUE,
       user_id          VARCHAR(100) NOT NULL,
       offer_id         INTEGER      REFERENCES p2p_offers(id) ON DELETE SET NULL,
       payment_type_id  INTEGER      REFERENCES p2p_payment_types(id) ON DELETE SET NULL,
       coin             VARCHAR(20)  NOT NULL,
       fiat             VARCHAR(20)  NOT NULL,
       price            NUMERIC(30,8) NOT NULL,
       crypto_amount    NUMERIC(30,8) NOT NULL,
       fiat_amount      NUMERIC(30,8) NOT NULL,
       account_name     VARCHAR(255),
       account_number   VARCHAR(100),
       ifsc_code        VARCHAR(50),
       upi_id           VARCHAR(255),
       qr_image         BYTEA,
       admin_note       TEXT,
       admin_payment_proof VARCHAR(255),
       status           VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
       expires_at       TIMESTAMPTZ,
       released_at      TIMESTAMPTZ,
       created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );

  // ── Disputes: verbatim from legacy/peerTrade/disputes_table.sql ──────
  // Kept exactly as shipped, including type choices that differ from the rest
  // of this migration — it is the one table whose real DDL is known.
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS p2p_disputes (
       id          SERIAL PRIMARY KEY,
       order_id    INTEGER NOT NULL,
       order_no    VARCHAR(50),
       user_id     VARCHAR(100),
       order_type  VARCHAR(10) DEFAULT 'BUY',
       reason      VARCHAR(100) NOT NULL,
       message     TEXT,
       screenshot  VARCHAR(255),
       status      VARCHAR(20) DEFAULT 'OPEN',
       admin_note  TEXT,
       resolved_at TIMESTAMPTZ,
       created_at  TIMESTAMPTZ DEFAULT NOW()
     )`,
    { transaction }
  );

  // ── Indexes for the queries the module actually runs ─────────────────
  const indexes = [
    'CREATE INDEX IF NOT EXISTS p2p_offers_lookup_idx ON p2p_offers (status, coin, fiat, segment)',
    'CREATE INDEX IF NOT EXISTS p2p_orders_user_idx ON p2p_orders (user_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS p2p_orders_status_idx ON p2p_orders (status, created_at DESC)',
    // The expiry sweep scans for open orders past their deadline.
    'CREATE INDEX IF NOT EXISTS p2p_orders_expiry_idx ON p2p_orders (expires_at) WHERE status = \'PENDING\'',
    'CREATE INDEX IF NOT EXISTS p2p_orders_sell_user_idx ON p2p_orders_sell (user_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS p2p_orders_sell_status_idx ON p2p_orders_sell (status, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS p2p_disputes_status_idx ON p2p_disputes (status, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS p2p_disputes_order_idx ON p2p_disputes (order_id)',
  ];
  for (const sql of indexes) await sequelize.query(sql, { transaction });

  logger?.info('Created 7 p2p tables (RECONSTRUCTED — see the migration header)');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping the p2p tables destroys every trade, order and dispute record. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if that is really intended.'
    );
  }

  // Reverse dependency order.
  for (const table of [
    'p2p_disputes',
    'p2p_orders_sell',
    'p2p_orders',
    'p2p_offer_payments',
    'p2p_offers',
    'p2p_payment_accounts',
    'p2p_payment_types',
  ]) {
    await sequelize.query(`DROP TABLE IF EXISTS ${table}`, { transaction });
  }

  logger?.warn('Dropped every p2p table');
}

module.exports = { up, down };

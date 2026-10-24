'use strict';

/**
 * currencies — the site's coin registry (display + switches), one row per code.
 *
 * Until now a coin's NAME, IMAGE and NETWORKS were hard-coded in the player
 * frontend and its on/off lived only in the `siteconfig` flag columns. This
 * table is the applied definition of every coin the site knows, like
 * `site_features` is for features:
 *
 *   code           PK, ^[A-Z][A-Z0-9]{1,9}$ (the wallet's currency code)
 *   kind           fiat | crypto | points
 *   decimals       display precision
 *   builtin        true for every coin with a `credits` column today; a coin
 *                  added later through the owner panel (phase B) is false
 *   owner_enabled  the owner's plan (`flags[<code>]` in the entitlement
 *                  document), written by admin-service when it applies one
 *   site_enabled   the site admin's switch (mirrors `siteconfig.<code>`)
 *   name, symbol, sort_order   what players see, in that order
 *   image_*        the coin's image, bytes in the row like `banners`
 *   networks       [{ key, name, enabled }] — `key` is the contract a deposit
 *                  or withdrawal names (TRC20, ERC20, …); `name` and `enabled`
 *                  are the site's to edit
 *   retired        BJB: still a balance column, never offered or credited
 *   managed_by     'owner' once an owner document has been applied
 *
 * The balances stay where they are (`credits.<code>` columns, the wallet's
 * fixed allow-list); this table never turns a code into a column.
 *
 * Seed: every code the wallet knows (`CURRENCY_COLUMN`), names as the player
 * site showed them, networks as its deposit screen listed them, images from
 * `packages/db/assets/coins/<code>.svg` where one exists, `site_enabled` from
 * the matching `siteconfig` flag column when there is one.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS, and the seed only inserts codes that
 * are missing (ON CONFLICT DO NOTHING) — a re-run never overwrites a name, an
 * image or a switch the site has changed. `down` drops the table.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ASSETS = path.join(__dirname, '..', 'assets', 'coins');

const net = (key, name = key) => ({ key, name, enabled: true });

/** The seed. Frozen here: a migration must not change when the code around it does. */
const SEED = [
  // Deposit rails the player site lists first, in its order.
  { code: 'INR', kind: 'fiat', decimals: 2, name: 'Indian Rupee', symbol: '₹', networks: [] },
  { code: 'USDT', kind: 'crypto', decimals: 6, name: 'Tether', symbol: 'USDT', networks: [net('TRC20'), net('ERC20'), net('BEP20')] },
  { code: 'BTC', kind: 'crypto', decimals: 8, name: 'Bitcoin', symbol: '₿', networks: [net('BTC', 'Bitcoin')] },
  { code: 'ETH', kind: 'crypto', decimals: 8, name: 'Ethereum', symbol: 'Ξ', networks: [net('ERC20')] },
  { code: 'LTC', kind: 'crypto', decimals: 8, name: 'Litecoin', symbol: 'Ł', networks: [net('LTC', 'Litecoin')] },
  { code: 'TRX', kind: 'crypto', decimals: 6, name: 'Tron', symbol: 'TRX', networks: [net('TRC20')] },
  { code: 'DOGE', kind: 'crypto', decimals: 8, name: 'Dogecoin', symbol: 'Ð', networks: [net('DOGE', 'Dogecoin')] },
  // Held and debitable, no deposit rail on the site yet.
  { code: 'BCH', kind: 'crypto', decimals: 8, name: 'Bitcoin Cash', symbol: 'BCH', networks: [] },
  { code: 'ADA', kind: 'crypto', decimals: 6, name: 'Cardano', symbol: 'ADA', networks: [] },
  { code: 'XRP', kind: 'crypto', decimals: 6, name: 'XRP', symbol: 'XRP', networks: [] },
  { code: 'BNB', kind: 'crypto', decimals: 8, name: 'BNB', symbol: 'BNB', networks: [] },
  { code: 'USDP', kind: 'crypto', decimals: 6, name: 'Pax Dollar', symbol: 'USDP', networks: [] },
  { code: 'NEXO', kind: 'crypto', decimals: 8, name: 'Nexo', symbol: 'NEXO', networks: [] },
  { code: 'MKR', kind: 'crypto', decimals: 8, name: 'Maker', symbol: 'MKR', networks: [] },
  { code: 'TUSD', kind: 'crypto', decimals: 6, name: 'TrueUSD', symbol: 'TUSD', networks: [] },
  { code: 'USDC', kind: 'crypto', decimals: 6, name: 'USD Coin', symbol: 'USDC', networks: [] },
  { code: 'BUSD', kind: 'crypto', decimals: 6, name: 'Binance USD', symbol: 'BUSD', networks: [] },
  { code: 'SHIB', kind: 'crypto', decimals: 2, name: 'Shiba Inu', symbol: 'SHIB', networks: [] },
  { code: 'MATIC', kind: 'crypto', decimals: 6, name: 'Polygon', symbol: 'MATIC', networks: [] },
  { code: 'SC', kind: 'crypto', decimals: 4, name: 'Siacoin', symbol: 'SC', networks: [] },
  { code: 'NC', kind: 'points', decimals: 2, name: 'Test coin', symbol: 'NC', networks: [] },
  { code: 'MVR', kind: 'fiat', decimals: 2, name: 'Maldivian Rufiyaa', symbol: 'Rf', networks: [] },
  { code: 'AED', kind: 'fiat', decimals: 2, name: 'UAE Dirham', symbol: 'AED', networks: [] },
  { code: 'NPR', kind: 'fiat', decimals: 2, name: 'Nepalese Rupee', symbol: 'रू', networks: [] },
  { code: 'PKR', kind: 'fiat', decimals: 2, name: 'Pakistani Rupee', symbol: '₨', networks: [] },
  { code: 'EUR', kind: 'fiat', decimals: 2, name: 'Euro', symbol: '€', networks: [] },
  { code: 'BDT', kind: 'fiat', decimals: 2, name: 'Bangladeshi Taka', symbol: '৳', networks: [] },
  // Retired: a balance may remain, nothing credits it, no list offers it.
  { code: 'BJB', kind: 'points', decimals: 2, name: 'Bonus balance', symbol: 'BJB', networks: [], retired: true },
];

async function siteconfigFlags(sequelize, transaction) {
  const { QueryTypes } = require('sequelize');
  const cols = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'siteconfig' AND data_type = 'boolean'`,
    { transaction, type: QueryTypes.SELECT }
  );
  const names = new Set(cols.map((c) => c.column_name));
  const wanted = SEED.map((c) => c.code.toLowerCase()).filter((c) => names.has(c));
  if (!wanted.length) return {};
  // Identifiers come from the constant seed above, filtered to real columns.
  const rows = await sequelize.query(
    `SELECT ${wanted.map((c) => `"${c}"`).join(', ')} FROM siteconfig ORDER BY id ASC LIMIT 1`,
    { transaction, type: QueryTypes.SELECT }
  );
  return rows[0] ?? {};
}

function seedImage(code) {
  const file = path.join(ASSETS, `${code.toLowerCase()}.svg`);
  if (!fs.existsSync(file)) return null;
  const data = fs.readFileSync(file);
  const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
  return { data, contentType: 'image/svg+xml', byteSize: data.length, asset: `${code.toLowerCase()}-${hash}.svg` };
}

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS currencies (
       code                VARCHAR(10)  PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9]{1,9}$'),
       kind                VARCHAR(10)  NOT NULL CHECK (kind IN ('fiat', 'crypto', 'points')),
       decimals            SMALLINT     NOT NULL DEFAULT 8 CHECK (decimals BETWEEN 0 AND 18),
       builtin             BOOLEAN      NOT NULL DEFAULT false,
       owner_enabled       BOOLEAN      NOT NULL DEFAULT true,
       site_enabled        BOOLEAN      NOT NULL DEFAULT true,
       name                VARCHAR(60)  NOT NULL,
       symbol              VARCHAR(12)  NOT NULL DEFAULT '',
       sort_order          INTEGER      NOT NULL DEFAULT 1000,
       image_asset         VARCHAR(64),
       image_data          BYTEA,
       image_content_type  VARCHAR(40),
       image_byte_size     INTEGER,
       networks            JSONB        NOT NULL DEFAULT '[]'::jsonb,
       retired             BOOLEAN      NOT NULL DEFAULT false,
       managed_by          VARCHAR(20),
       updated_by          VARCHAR(190),
       created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  const flags = await siteconfigFlags(sequelize, transaction);
  let inserted = 0;
  for (const [i, c] of SEED.entries()) {
    const image = seedImage(c.code);
    const flag = flags[c.code.toLowerCase()];
    const [, meta] = await sequelize.query(
      `INSERT INTO currencies
         (code, kind, decimals, builtin, owner_enabled, site_enabled, name, symbol, sort_order,
          image_asset, image_data, image_content_type, image_byte_size, networks, retired, updated_by)
       VALUES
         (:code, :kind, :decimals, true, true, :siteEnabled, :name, :symbol, :sortOrder,
          :asset, :data, :contentType, :byteSize, CAST(:networks AS jsonb), :retired, 'migration:061')
       ON CONFLICT (code) DO NOTHING`,
      {
        transaction,
        replacements: {
          code: c.code,
          kind: c.kind,
          decimals: c.decimals,
          siteEnabled: typeof flag === 'boolean' ? flag : true,
          name: c.name,
          symbol: c.symbol,
          sortOrder: (i + 1) * 10,
          asset: image?.asset ?? null,
          data: image?.data ?? null,
          contentType: image?.contentType ?? null,
          byteSize: image?.byteSize ?? null,
          networks: JSON.stringify(c.networks),
          retired: c.retired === true,
        },
      }
    );
    inserted += typeof meta === "number" ? meta : (meta?.rowCount ?? 0);
  }
  logger?.info({ inserted, known: SEED.length }, 'currencies: registry table ready');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP TABLE IF EXISTS currencies', { transaction });
  logger?.warn('Dropped currencies (names, images and network names the site edited are gone)');
}

module.exports = { up, down, SEED };

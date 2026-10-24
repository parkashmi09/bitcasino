'use strict';

/**
 * Coin registry clean-up: seed images for the coins 061 had none for, and the
 * test coin off for players.
 *
 * 1. IMAGES. 061 read `packages/db/assets/coins/<code>.svg` where one existed;
 *    NC, MVR, AED, NPR, PKR, EUR and BDT had none, so their rows have no image
 *    and the cashier shows a blank disc. The assets now exist (currency sign on
 *    a neutral disc). A fresh install gets them from 061 directly; this fills
 *    them into a registry 061 already seeded — ONLY where `image_data IS NULL`,
 *    so an image the site admin uploaded is never replaced.
 *
 * 2. NC IS THE TEST COIN. It is play money: in-house games refuse it
 *    (`PLAY_COIN_BLOCKED`), withdrawals refuse it, tips and rain refuse it
 *    (`TIP_BLOCKED_CURRENCIES` — legacy: "NC is the test coin !"). Yet the
 *    registry seeded it `site_enabled = true`, so players were offered it.
 *    Its site switch goes off here, in both places it lives: the registry row
 *    and its `siteconfig.nc` mirror (the column default too, so the settings
 *    row a fresh install creates after migrations starts with it off). The
 *    site admin can still switch it on from Finance → Coins.
 *
 * Idempotent: every write is conditional and re-running changes nothing.
 * `down` restores the `siteconfig.nc` default only — it does not remove images
 * or switch NC back on for players.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { QueryTypes } = require('sequelize');

const ASSETS = path.join(__dirname, '..', 'assets', 'coins');

/** Frozen: the codes 061 seeded without an image. */
const CODES = ['NC', 'MVR', 'AED', 'NPR', 'PKR', 'EUR', 'BDT'];
const TEST_COIN = 'NC';

function seedImage(code) {
  const file = path.join(ASSETS, `${code.toLowerCase()}.svg`);
  if (!fs.existsSync(file)) return null;
  const data = fs.readFileSync(file);
  const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
  return { data, contentType: 'image/svg+xml', byteSize: data.length, asset: `${code.toLowerCase()}-${hash}.svg` };
}

async function hasColumn(sequelize, transaction, table, column) {
  const rows = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
    { transaction, type: QueryTypes.SELECT, replacements: { table, column } }
  );
  return rows.length > 0;
}

async function up({ sequelize, transaction, logger }) {
  if (!(await hasColumn(sequelize, transaction, 'currencies', 'image_data'))) {
    logger?.warn('currencies table missing — 066 has nothing to do');
    return;
  }

  let images = 0;
  for (const code of CODES) {
    const image = seedImage(code);
    if (!image) continue;
    const [, meta] = await sequelize.query(
      `UPDATE currencies
          SET image_asset = :asset, image_data = :data, image_content_type = :contentType,
              image_byte_size = :byteSize, updated_by = 'migration:066', updated_at = now()
        WHERE code = :code AND image_data IS NULL`,
      { transaction, replacements: { code, ...image } }
    );
    images += typeof meta === 'number' ? meta : (meta?.rowCount ?? 0);
  }

  const [, off] = await sequelize.query(
    `UPDATE currencies SET site_enabled = false, updated_by = 'migration:066', updated_at = now()
      WHERE code = :code AND site_enabled = true`,
    { transaction, replacements: { code: TEST_COIN } }
  );

  const flag = TEST_COIN.toLowerCase();
  if (await hasColumn(sequelize, transaction, 'siteconfig', flag)) {
    // Identifier from the constant above, checked to be a real column.
    await sequelize.query(`ALTER TABLE siteconfig ALTER COLUMN "${flag}" SET DEFAULT false`, { transaction });
    await sequelize.query(`UPDATE siteconfig SET "${flag}" = false WHERE "${flag}" IS DISTINCT FROM false`, { transaction });
  }

  logger?.info(
    { images, testCoinSwitchedOff: (typeof off === 'number' ? off : (off?.rowCount ?? 0)) > 0 },
    'currencies: seed images filled, test coin off for players'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (await hasColumn(sequelize, transaction, 'siteconfig', 'nc')) {
    await sequelize.query('ALTER TABLE siteconfig ALTER COLUMN "nc" SET DEFAULT true', { transaction });
  }
  logger?.warn('066 down: siteconfig.nc default restored; images and the NC switch are left as they are');
}

module.exports = { up, down, CODES };

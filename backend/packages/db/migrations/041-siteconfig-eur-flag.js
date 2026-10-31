'use strict';

/**
 * `siteconfig.eur` — the one wallet currency an operator cannot switch off.
 *
 * `wallet.constants.js` declares TWENTY-EIGHT currency columns, and
 * `siteConfig.service.js` carries a public flag for twenty-seven of them:
 *
 *     inr mvr aed pkr bdt npr cryptocoin
 *     btc eth ltc bch usdt trx doge ada xrp bnb
 *     usdp nexo mkr tusd usdc busd shib matic nc sc bjb
 *
 * `eur` is missing, and nothing about it is special — it is a fiat column on
 * `credits` exactly as `inr` and `aed` are, and a player can hold a balance in
 * it. The omission looks like a transcription gap rather than a decision: the
 * six fiats are listed together and EUR is simply not among them.
 *
 * It became worth fixing when the front-end started GATING ITS WALLET ON THESE
 * FLAGS. `publicSettings()` is what a browser reads to decide which currencies
 * to draw, and an absent flag has to default to ON — anything else would hide a
 * currency because the operator never configured it. So EUR would be the single
 * currency on the platform that is permanently visible: every other one can be
 * turned off from the staff screen, that one cannot.
 *
 * DEFAULT true, matching every other currency flag and matching how
 * `publicSettings()` reports an absent row — a deployment that has not
 * configured itself is not one that switched a currency off. Existing rows
 * therefore keep EUR on, so this migration changes nothing a visitor can see
 * until an operator decides otherwise.
 *
 * NOT NULL, because a third state is a question nothing asks: a null would read
 * as off in one branch and on in another. Same reasoning as 034 and 035.
 *
 * `OPERATOR_FLAGS` is `[...PUBLIC_FLAGS, 'sports', 'home_livesports']`, so
 * adding the name to the public list is also what makes the staff screen able
 * to write it. The column and the allow-list entry have to land together —
 * either alone leaves a switch with nowhere to go, which is the defect 035
 * describes.
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  const [existing] = await sequelize.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'siteconfig'
        AND column_name = 'eur'`,
    { transaction, type: QueryTypes.SELECT }
  );

  if (existing) {
    logger?.info('siteconfig.eur already present — nothing to do');
    return;
  }

  await sequelize.query(
    `ALTER TABLE siteconfig
       ADD COLUMN eur boolean DEFAULT true NOT NULL`,
    { transaction }
  );

  logger?.info(
    'Added siteconfig.eur — the twenty-eighth wallet currency, and the only one with no operator switch'
  );
}

/**
 * No `down()`.
 *
 * Dropping it takes EUR back out of the allow-list's reach while the column is
 * gone, which is the state this migration exists to end. Reversing a migration
 * should not be a way to reintroduce a gap — see 034 and 035.
 */
module.exports = { up };

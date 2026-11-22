'use strict';

const { QueryTypes } = require('sequelize');
const { money, AppError } = require('@ibitplay/common');

/**
 * Exposure limit — client user (agent tree ka player) ki max open exposure.
 *
 *   - Value `credits.exposure_limit` (player ki row, uid) me; 0 = koi limit nahi.
 *   - Sirf client user (`parent_staff_id` set). Direct user pe nahi.
 *   - Sirf SEEDHA parent set karta hai (`parent_staff_id === actor.id`); upar wale nahi.
 *   - Sports placeBet check karta hai (`sports lib/helper/exposureLimit.mjs`).
 */

const notFound = () => new AppError('User not found', 404, 'EXPOSURE_LIMIT_USER_NOT_FOUND');
const walletNotFound = () => new AppError('Wallet not found', 404, 'EXPOSURE_LIMIT_WALLET_NOT_FOUND');
const show = (value) => money.fromStored(value ?? '0', { field: 'balance' });

/**
 * Ek client user ki exposure limit badlo. Caller ki transaction me chalta hai;
 * wallet row lock hoti hai taaki saath chal rahe placeBet ke saath race na ho.
 */
async function setUserExposureLimit(sequelize, { actor, userId, exposureLimit }, { transaction }) {
  const [user] = await sequelize.query('SELECT id, name, parent_staff_id FROM users WHERE id = :userId', {
    replacements: { userId },
    type: QueryTypes.SELECT,
    transaction,
  });
  // One answer for missing, a direct user and another parent's player: the code must not tell a
  // caller from another tree which of the three an id is.
  if (!user || user.parent_staff_id == null || String(user.parent_staff_id) !== String(actor.id)) throw notFound();

  const [wallet] = await sequelize.query('SELECT exposure_limit FROM credits WHERE uid = :userId FOR UPDATE', {
    replacements: { userId },
    type: QueryTypes.SELECT,
    transaction,
  });
  if (!wallet) throw walletNotFound();
  const oldExposureLimit = show(wallet.exposure_limit);

  await sequelize.query('UPDATE credits SET exposure_limit = :exposureLimit WHERE uid = :userId', {
    replacements: { userId, exposureLimit },
    type: QueryTypes.UPDATE,
    transaction,
  });

  return {
    userId: String(user.id),
    username: user.name,
    oldExposureLimit,
    newExposureLimit: show(exposureLimit),
  };
}

module.exports = { setUserExposureLimit };

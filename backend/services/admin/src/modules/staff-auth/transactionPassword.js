'use strict';

const { z, defineErrors } = require('@ibitplay/common');
const { hashPassword, verifyPassword, isLoginPasswordMode, transactionPasswordMode } = require('@ibitplay/auth');

const { PASSWORD_ROUNDS } = require('./staffAuth.constants');
const { verifyTransactionPassword } = require('../staff-directory/staffDirectory.service');

/**
 * The staff TRANSACTION PASSWORD — the second secret every money move asks for.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THERE WAS NO WAY TO SET ONE
 *
 * `staff.transaction_password` was read by every money route (lords refill,
 * provider toggles, wallet adjust) and written by none: an account created
 * here had no transaction password, and `verifyTransactionPassword` correctly
 * refuses an unset one — so those routes were unusable for every new staff
 * member, and the wallet adjust route simply skipped the check.
 *
 * `POST /admin/auth/transaction-password` sets or changes it. It requires the
 * caller's LOGIN password (a stolen session alone cannot set the second
 * factor), it is stored as a bcrypt hash exactly like the login password, and
 * it may not equal the login password — a second factor that is the first
 * factor is not one.
 *
 * An EXECUTIVE session acts for its parent staff account and signs in with its
 * own password, not the parent's; it may use the parent's transaction password
 * but may not change it.
 *
 * TXN_PASSWORD_MODE (`@ibitplay/auth` transactionPasswordMode):
 *   login    (default) — the transaction password IS the login password. It
 *            is always "set", every check compares against the login hash (an
 *            executive's own), and there is nothing to set: POST refuses with
 *            409 TXN_PASSWORD_LOGIN_MODE.
 *   separate — everything above.
 * The REQUIRED / INVALID refusals are identical in both modes.
 * ═════════════════════════════════════════════════════════════════════════
 */

const errors = defineErrors('TXN_PASSWORD', {
  REQUIRED: { status: 403, message: 'This action requires your transaction password' },
  INVALID: { status: 403, message: 'The transaction password is not correct' },
  NOT_SET: {
    status: 403,
    message: 'Set a transaction password under My account before moving money',
  },
  LOGIN_PASSWORD_WRONG: { status: 403, message: 'Your current login password is not correct' },
  SAME_AS_LOGIN: { status: 422, message: 'The transaction password must differ from your login password' },
  EXECUTIVE_CANNOT_SET: {
    status: 403,
    message: 'An executive session cannot change the account transaction password',
  },
  NOT_FOUND: { status: 404, message: 'Staff account not found' },
  LOGIN_MODE: {
    status: 409,
    message: 'Your transaction password is your login password; there is nothing separate to set',
  },
});

const MIN_LENGTH = 6;

const setSchema = {
  body: z
    .object({
      currentPassword: z.string().min(1).max(200),
      transactionPassword: z.string().min(MIN_LENGTH, `at least ${MIN_LENGTH} characters`).max(128),
    })
    .strict(),
};

/**
 * Does this staff account have a transaction password at all? Always true in
 * login mode — a login password always exists, so nothing reports "not set".
 */
async function hasTransactionPassword(models, staffId) {
  if (isLoginPasswordMode()) return true;
  const row = await models.Staff.findByPk(staffId, { attributes: ['transaction_password'], raw: true });
  return Boolean(row?.transaction_password);
}

/**
 * The check every money move calls.
 *
 * `required: true`  — the account MUST have one and the candidate must match
 *                     (agent-tree money moves, lords writes).
 * `required: false` — enforced only when the account has one set (house wallet
 *                     adjust: an owner account seeded without one keeps
 *                     working, but once set it is always asked for).
 *
 * @returns {Promise<{set: boolean, verified: boolean}>}
 */
async function assertTransactionPassword(models, staffId, candidate, { required = true, executiveId = null } = {}) {
  const set = await hasTransactionPassword(models, staffId);

  if (!set) {
    if (required) throw errors.NOT_SET();
    return { set: false, verified: false };
  }
  if (typeof candidate !== 'string' || !candidate) throw errors.REQUIRED();
  if (!(await verifyTransactionPassword(models, staffId, candidate, { executiveId }))) throw errors.INVALID();
  return { set: true, verified: true };
}

/** Set or change the caller's own transaction password. */
async function setTransactionPassword(models, { staffId, executiveId, currentPassword, transactionPassword, logger }) {
  if (isLoginPasswordMode()) throw errors.LOGIN_MODE();
  if (executiveId) throw errors.EXECUTIVE_CANNOT_SET();

  const row = await models.Staff.findByPk(staffId, { attributes: ['id', 'password', 'transaction_password'], raw: true });
  if (!row) throw errors.NOT_FOUND();

  if (!(await verifyPassword(currentPassword, row.password ?? ''))) throw errors.LOGIN_PASSWORD_WRONG();
  if (await verifyPassword(transactionPassword, row.password ?? '')) throw errors.SAME_AS_LOGIN();

  await models.Staff.update(
    { transaction_password: await hashPassword(transactionPassword, PASSWORD_ROUNDS) },
    { where: { id: staffId } }
  );

  logger?.warn({ staffId, replaced: Boolean(row.transaction_password) }, 'Staff transaction password set');
  return { staffId: Number(staffId), set: true, changed: Boolean(row.transaction_password) };
}

module.exports = {
  errors,
  setSchema,
  hasTransactionPassword,
  assertTransactionPassword,
  setTransactionPassword,
  MIN_LENGTH,
  transactionPasswordMode,
};

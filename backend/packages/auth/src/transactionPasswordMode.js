'use strict';

/**
 * Which secret a staff money move asks for — `TXN_PASSWORD_MODE`.
 *
 *   login     (default) the "transaction password" IS the account's login
 *             password: every money move re-checks the login password, and
 *             there is nothing separate to set. An executive session is
 *             checked against the executive's OWN login password.
 *   separate  the legacy second secret, `staff.transaction_password`, set
 *             through `POST /admin/auth/transaction-password`.
 *
 * Read at call time (not cached), so a test can flip it. Anything other than
 * `separate` is `login` — the safe default asks for a password that always
 * exists rather than one that may never have been set.
 */
const TXN_PASSWORD_MODES = Object.freeze({ LOGIN: 'login', SEPARATE: 'separate' });

const transactionPasswordMode = (env = process.env) =>
  String(env.TXN_PASSWORD_MODE ?? '').trim().toLowerCase() === TXN_PASSWORD_MODES.SEPARATE
    ? TXN_PASSWORD_MODES.SEPARATE
    : TXN_PASSWORD_MODES.LOGIN;

const isLoginPasswordMode = (env = process.env) => transactionPasswordMode(env) === TXN_PASSWORD_MODES.LOGIN;

module.exports = { TXN_PASSWORD_MODES, transactionPasswordMode, isLoginPasswordMode };

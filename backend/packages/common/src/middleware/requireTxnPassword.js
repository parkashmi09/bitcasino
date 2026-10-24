'use strict';

const { AppError } = require('../errors');

/**
 * Route guard for a staff action that gives or takes balance: the caller's transaction code
 * (`body.transactionPassword`) must be right before the handler runs. Checked by admin-service,
 * which owns the hash (`/internal/admin/staff-directory/verify-transaction-password`).
 *
 * The field is removed once checked, so the route's strict validator and the handler never see
 * it. Mount it after any multipart parser (the field arrives in the form) and before `validate`.
 */
function requireTxnPassword({ clients }) {
  return async (req, _res, next) => {
    try {
      const code = req.body?.transactionPassword;
      if (typeof code !== 'string' || !code) {
        throw new AppError('This action requires your transaction password', 403, 'TXN_PASSWORD_REQUIRED');
      }
      await clients.admin.post('/internal/admin/staff-directory/verify-transaction-password', {
        staffId: req.staff.id,
        transactionPassword: code,
        ...(req.staff.executiveId ? { executiveId: req.staff.executiveId } : {}),
      });
      delete req.body.transactionPassword;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { requireTxnPassword };

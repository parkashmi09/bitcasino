'use strict';

/**
 * Direct User Wallet — admin-structure.zip ka "Wallet" (WalletUpdate) page.
 *
 * Super Admin direct users (koi parent nahi) ko kisi bhi currency me credit / debit karta hai,
 * apne Direct User wallet (`staff_balances`, INR) se — rate ke hisaab se INR kat-ta / judta hai.
 * Sports Exchange ke agent users yahan nahi (unka paisa points / `credits.inr` se).
 */
module.exports = {
  name: 'direct-wallet',
  service: 'admin',
  basePath: '/direct-wallet',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};

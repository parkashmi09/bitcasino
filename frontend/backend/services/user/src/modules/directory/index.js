'use strict';

/**
 * The player directory, for operators.
 *
 *   `GET /users` WAS `SELECT * FROM users`, UNAUTHENTICATED. Every row and
 *   every column — including `password` and `password2`, the bcrypt hashes
 *   login checks — to anyone who could reach the port.
 *
 *   `GET /user-summary` JOINED TWO ONE-TO-MANY TABLES IN ONE QUERY, so a player
 *   with 3 deposits and 4 withdrawals produced 12 rows and every deposit was
 *   counted four times. Every figure on the report was inflated by the row
 *   count of the other table.
 *
 *   `DELETE /deleteUser` ENUMERATED `information_schema` AND DELETED FROM EVERY
 *   TABLE with a column named `user_id`, `userid`, `uid`, `id_user` or `user` —
 *   the ledger, the bets, the deposits, the KYC record. Unauthenticated, with
 *   the id in the body. It answers 501 here and says what to do instead.
 */
module.exports = {
  name: 'directory',
  service: 'user',
  basePath: '/directory',
  models: ['core', 'payments'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};

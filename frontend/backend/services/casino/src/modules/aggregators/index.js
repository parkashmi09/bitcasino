'use strict';

/**
 * The three remaining casino aggregators: asiaapi.net, nexusggreu.com, and EVO.
 *
 *   NONE OF THE THREE HAD ANY AUTHENTICATION. `/processRequest` accepted
 *   `{"cmd":"writeBet","login":<any player>,"bet":"0.01","win":"1000000"}` from
 *   anyone who could reach the port, and credited it.
 *
 *   NONE HAD DUPLICATE DETECTION — no provider transaction id was recorded
 *   anywhere it could be checked, so every retry settled again.
 *
 *   ALL THREE WROTE THE BALANCE AS AN ABSOLUTE VALUE, so two concurrent
 *   settlements lost one of themselves.
 *
 *   `/callback_evo` ANSWERED 200 AND SETTLED A SECOND LATER in a detached
 *   timer, and read `queue.client` before checking `queue` existed — so a player
 *   who closed their browser mid-round threw a TypeError instead of being paid.
 *
 *   `transaction_live` and `transaction_slot` store money in BIGINT columns, so
 *   every amount legacy wrote to them was rounded to a whole unit. Migration
 *   017 records settlements in NUMERIC columns instead; the legacy tables stay
 *   as the historical record.
 */
module.exports = {
  name: 'aggregators',
  service: 'casino',
  basePath: '/aggregators',
  models: ['casino', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
  },
};

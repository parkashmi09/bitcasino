'use strict';

/**
 * Presence — how many people are connected right now.
 *
 * The one module here with no table behind it: the answer is derived from the
 * socket transport's own room table, because a stored "who is online" list is
 * a list that is wrong the moment a process dies without tidying up.
 *
 * It exists because nothing else could answer the question. `C.ONLINE` is an
 * identity read on one socket, and `casino/games/stats` — which
 * `BACKEND-GAP-REPORT.md` §6 proposed for this — counts GAMES. See
 * `presence.service.js`.
 *
 * `models: []` on purpose. Adding one would be inviting somebody to persist
 * this.
 */
module.exports = {
  name: 'presence',
  service: 'user',
  basePath: '/presence',
  models: [],
  routers: {
    public: require('./routes/public.routes'),
  },
};

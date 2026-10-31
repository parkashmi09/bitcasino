'use strict';

/**
 * The weekly raffle (rainbet) — owner feature `raffles`, the player site's `/raffle`.
 *
 * Tables: migration 164. Not in hash-game-exchange — on the hash-sync KEEP list.
 */
module.exports = {
  name: 'raffle',
  service: 'user',
  basePath: '/raffle',
  /* `extended` for the raffle tables, `core` for `Users`, the ledger and `Userwager` (medals). */
  models: ['core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
  jobs: [
    {
      name: 'raffle:draw',
      intervalMs: 5 * 60_000,
      immediate: true,
      run: (container) => require('./raffle.jobs').createDrawJob(container)(),
    },
  ],
};

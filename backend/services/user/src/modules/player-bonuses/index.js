'use strict';

/**
 * The bonus balance and its wagering lock (migration 076).
 *
 * A granted bonus (first-deposit, spin wheel) is a `player_bonuses` row, not cash. Every counted
 * stake (`wager/wagerActivity.service.js`) moves the player's active bonuses toward their
 * requirement, oldest first; a refund / rollback takes it back out. When a bonus's requirement is
 * met its amount is credited to cash in the same transaction. Withdrawals take cash only, and
 * forfeit any active bonus once the player confirms. See `playerBonus.service.js`.
 *
 *   public GET  /api/v1/user/bonus-balance/contribution    the game ratio the player is shown
 *   user   GET  /api/v1/user/bonus-balance                 the player's bonus balance + progress
 *   admin  GET  /api/v1/admin/user/bonus-balance           report (tree-scoped)
 *          GET  /api/v1/admin/user/bonus-balance/users/:userId
 *          POST /api/v1/admin/user/bonus-balance/:id/forfeit   (audited)
 */
module.exports = {
  name: 'player-bonuses',
  service: 'user',
  basePath: '/bonus-balance',
  models: ['core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
  jobs: [
    {
      /** An unwagered bonus past its expiry is forfeited (reads also expire lazily). */
      name: 'player-bonuses:expire',
      intervalMs: 10 * 60_000,
      immediate: true,
      run: async (container) => {
        const { PlayerBonusService } = require('./playerBonus.service');
        await new PlayerBonusService(container).expireDue();
      },
    },
  ],
};

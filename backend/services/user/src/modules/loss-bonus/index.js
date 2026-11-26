'use strict';

/**
 * Loss bonus (lossback) — a share of the player's net loss over the last completed period,
 * claimed by the player. Terms are the Super Admin's (Limits and policy → Loss bonus); the paid
 * bonus is a `player_bonuses` row (source `loss_bonus`). See `lossBonus.service.js`.
 */
module.exports = {
  name: 'loss-bonus',
  service: 'user',
  basePath: '/loss-bonus',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
  },
  jobs: [
    {
      /** "Auto credit" on (Limits and policy → Loss bonus): grant every ended window's bonus. Off = does nothing. */
      name: 'loss-bonus:auto-credit',
      intervalMs: 10 * 60_000,
      immediate: false,
      run: async (container) => {
        const { LossBonusService } = require('./lossBonus.service');
        await new LossBonusService(container).autoGrantDue();
      },
    },
  ],
};

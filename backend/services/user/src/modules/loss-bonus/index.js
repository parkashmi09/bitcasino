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
};

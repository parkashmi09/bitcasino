'use strict';

/**
 * The Quest Hub's daily quests — `GET /api/v1/user/quests`.
 *
 * Progress: today's wager and today's bet count, read from the daily race's board (the one
 * place that already folds casino + sports turnover for a window, in the race's time zone), so
 * the hub and the Daily Contest agree on what "today" and "wagered" mean.
 * Rewards: `POST /api/v1/user/quests/:key/claim` pays a completed quest once per day, in USD set
 * by the Super Admin (`quest_*_reward`), through PlayerBonusService.grant (source `quest`).
 */
module.exports = {
  name: 'quests',
  service: 'user',
  basePath: '/quests',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
  },
};

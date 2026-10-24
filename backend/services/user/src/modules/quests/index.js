'use strict';

/**
 * The Quest Hub's daily quests — `GET /api/v1/user/quests`.
 *
 * Progress only: today's wager and today's bet count, read from the daily race's board (the one
 * place that already folds casino + sports turnover for a window, in the race's time zone), so
 * the hub and the Daily Contest agree on what "today" and "wagered" mean. No rewards and no
 * claims yet — there is no quest payout on this platform (owner, 2026-10-19: the list must work).
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

'use strict';

/**
 * Profile medals (achievements) — backend-gaps gap 9.
 *
 * The 23 medals of the player site's Medals dialog, each measured on real
 * platform data where a rule can be (see `medals.constants.js`), evaluated on
 * read and recorded in `user_medals` (migration 093) the first time it is met.
 *
 * Player route   GET /api/v1/user/medals                     (own, signed in)
 * Public route   GET /api/v1/user/profile/:userId/medals     (unlocked only;
 *                mounted by the `profile` module beside `/:userId/public`)
 *
 * COSMETIC ONLY. The reference site pays reward chests at 5/10/15/20 medals;
 * nothing here pays, so no money path, no `reward-currency` conversion and no
 * agent-tree gate. Paying them would be an owner decision (amounts, currency,
 * agent players) and a new claim route through the wallet spine.
 *
 * No privacy flag is honoured because none exists: `userconfig` has
 * `hide_balance` and no "hide gaming data" (see `ProfileService.publicProfile`).
 * The public view carries no figures — titles and dates only.
 */
module.exports = {
  name: 'medals',
  service: 'user',
  basePath: '/medals',
  /* `core` for users/userwager/chat, `extended` for user_medals, tips, races and SiteFeature (the VIP ladder). */
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
  },
};

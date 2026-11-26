'use strict';

/**
 * Team logos / country flags by team name, for the player site's match cards
 * (`GET /api/v1/sports/team-logos?name=…`). See teamLogos.service.js.
 */
module.exports = {
  name: 'team-logos',
  service: 'sports',
  basePath: '/team-logos',

  routers: {
    public: require('./routes/public.routes'),
  },
};

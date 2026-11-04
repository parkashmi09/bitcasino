'use strict';

/**
 * The whitelabel casino hub (docs/plans/2026-11-01-whitelabel-plan-and-casino-hub.md, Part B).
 *
 * On the PARENT (a copy calls in, signed with its key — common/hubLink):
 *   public  POST /api/v1/casino/wl-hub/gis/provider   a Slotegrator call made on the parent's account
 *                                                       (open a game, demo, lobby, catalogue reads)
 *   Slotegrator's callbacks for a copy's player (`wl<id>_<player>`) are passed on to the copy by
 *   gis.service (forward.js) and recorded in whitelabel_casino_rounds.
 *
 * On a COPY (the parent calls in):
 *   public  POST /api/v1/casino/wl-hub/in/gis          a verified Slotegrator callback to settle
 */
module.exports = {
  name: 'wl-hub',
  service: 'casino',
  basePath: '/wl-hub',
  models: ['casino', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
  },
};

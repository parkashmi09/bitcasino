'use strict';

/**
 * Original Games Aggregator — the BC Originals (crash, mines, dice…) on a seamless wallet.
 * Integration guide: backend/docs/original-games-integration-guide.md.
 *
 *   user    POST /api/v1/casino/original-games/launch   signed launch, INR or USDT
 *   public  POST /api/v1/casino/original-games/wallet/{balance,bet,win,rollback,transaction}
 *           — `callback_base_url` is `<api host>/api/v1/casino/original-games/wallet`
 *   admin   GET|PUT /api/v1/admin/casino/original-games/games — one game on / off
 *
 * Config: OG_BASE_URL, OG_API_KEY, OG_API_SECRET, OG_WEBHOOK_SECRET, OG_ENV (sandbox|production).
 */
module.exports = {
  name: 'original-games',
  service: 'casino',
  basePath: '/original-games',
  models: ['casino', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};

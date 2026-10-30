'use strict';

/**
 * whitelabel-link — a whitelabel copy's API for its PARENT site's Whitelabel panel.
 *
 *   GET  /api/v1/admin/whitelabel-link/status           { maintenance } — no key (the gateway polls it)
 *   GET  /api/v1/admin/whitelabel-link/theme            { palette } — no key (the player site's custom colours)
 *   POST /api/v1/admin/whitelabel-link/preview/redeem   one-time code → read-only company session — no key
 *
 * The rest need `x-whitelabel-key: WHITELABEL_LINK_KEY` AND a direct call (no X-Forwarded-For —
 * the gateway always adds one), so only the parent, on the same machine, reaches them:
 *
 *   GET  /summary            company, its two balances, counts, total received, maintenance
 *   POST /credit             { transferId, amount, note? } → company Direct User balance (idempotent)
 *   POST /company-password   { password } → reset; every company session ends
 *   PUT  /maintenance        { on }
 *   PUT  /palette            { palette: { bg, s1 … lo } | null }
 *   PUT  /branding           { slot: logo|mark, type, data(base64) } — the Super Admin's image slots
 *   PUT  /poster             { placement: home|home_mobile, type, data(base64) } — the home-page poster
 *   POST /preview            → { code } for /preview?code= on this site's admin
 */
module.exports = {
  name: 'whitelabel-link',
  service: 'admin',
  basePath: '/whitelabel-link',
  models: [],
  routers: {
    public: require('./routes/public.routes'),
  },
};

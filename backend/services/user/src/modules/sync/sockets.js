'use strict';

const crypto = require('node:crypto');
const { AUDIENCE, PLATFORM_EVENTS } = require('@ibitplay/socket');

const { AuthService } = require('../auth/auth.service');
const { WalletService } = require('../wallet/wallet.service');
const { PreferencesService } = require('../preferences/preferences.service');
const { ProfileService } = require('../profile/profile.service');
const { RegionService } = require('../region/region.service');

/**
 * `SYNC_STATE` — the client's whole state in one socket read, asked every 2 s.
 *
 *   { me, profile, balances, preferences }   signed in only (the same bodies as /user/auth/me,
 *                                            /user/profile, /user/wallet/balances, /user/preferences)
 *   { exposure }                             signed in only: open sports liability, INR, positive
 *   { flags, features, currencies, branding, avatars }
 *                                            everyone (/admin/site-config/public,
 *                                            /admin/features/public, /admin/currencies/public,
 *                                            /admin/branding/public, /admin/avatars/public)
 *   { region }                               everyone, for THIS socket's address (/user/region)
 *
 * The site half is admin-service's and the same for every player, so it is read at most once per
 * SITE_TTL_MS for the whole process, however many sockets poll.
 *
 * ── THE REPLY IS SCRAMBLED, NOT ENCRYPTED ────────────────────────────────
 * `{ status, d }` where `d` = base64(JSON XOR sha256(`${socket.id}:${SALT}`)). The key changes with
 * every connection, so a frame copied out of devtools reads as noise. The client holds the salt
 * to unscramble it, so this keeps casual eyes out; it is not a secret from someone reading the
 * bundle. Nothing in it is more than what the same player can already read over HTTP.
 */
const SALT = 'p567.sync.v1';
const SITE_TTL_MS = 5000;

const keyFor = (socketId) => crypto.createHash('sha256').update(`${socketId}:${SALT}`).digest();

function scramble(value, key) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  for (let i = 0; i < bytes.length; i += 1) bytes[i] ^= key[i % key.length];
  return bytes.toString('base64');
}

/* The site half of the state, shared by every socket of this process (see SITE_TTL_MS). */
let site = null;
let siteAt = 0;

/** A push from admin-service (owner / operator save): the next sync reads the site afresh. */
function invalidateSiteState() {
  siteAt = 0;
}

function register({ on, deps }) {
  const { logger, clients } = deps;
  const auth = new AuthService(deps);
  const wallet = new WalletService(deps);
  const preferences = new PreferencesService(deps);
  const profile = new ProfileService(deps);
  const region = new RegionService(deps);

  let siteLoading = null;

  const body = (result) => (result && typeof result === 'object' && 'data' in result ? result.data : result);

  async function readSite() {
    const quiet = (what) => (error) => {
      logger?.debug({ err: error.message }, `Sync could not read the ${what}`);
      return null;
    };
    const [config, currencies, branding, avatars] = await Promise.all([
      clients.admin.get('/internal/admin/site-config/public').then(body),
      clients.admin.get('/internal/admin/currencies/public').then(body),
      // An older admin-service has no internal branding route: the client then reads it over HTTP.
      clients.admin.get('/internal/admin/branding/public').then(body).catch(quiet('branding')),
      clients.admin.get('/internal/admin/avatars/public').then(body).catch(quiet('avatars')),
    ]);
    return {
      flags: config?.flags ?? {},
      features: Array.isArray(config?.features) ? config.features : [],
      currencies: Array.isArray(currencies) ? currencies : [],
      ...(branding ? { branding } : {}),
      ...(Array.isArray(avatars) ? { avatars } : {}),
    };
  }

  function siteState() {
    if (site && Date.now() - siteAt < SITE_TTL_MS) return Promise.resolve(site);
    siteLoading ??= readSite()
      .then((next) => {
        site = next;
        siteAt = Date.now();
        return next;
      })
      .catch((error) => {
        logger?.warn({ err: error.message }, 'Sync could not read the site config');
        return site;
      })
      .finally(() => {
        siteLoading = null;
      });
    return siteLoading;
  }

  const settle = (promise) => promise.catch(() => null);

  /* The player's open sports liability, INR, as a positive number (mssports keeps one row per
     player in `total_exposures`, keyed on the platform user id). No row = nothing open = 0. */
  const readExposure = async (userId) => {
    const [row] = await deps.db.sequelize.query(
      'SELECT total_exposure FROM mssports.total_exposures WHERE user_id = :userId ORDER BY id DESC LIMIT 1',
      { replacements: { userId }, type: 'SELECT' }
    );
    return Math.abs(Number(row?.total_exposure) || 0);
  };

  on(PLATFORM_EVENTS.SYNC_STATE, {
    audience: AUDIENCE.PUBLIC,
    limit: { windowMs: 10_000, max: 20 },
    handle: async (_payload, context) => {
      const userId = context.userId ? String(context.userId) : null;
      const [siteHalf, me, balances, prefs, record, area, exposure] = await Promise.all([
        siteState(),
        userId ? settle(auth.me(userId)) : null,
        userId ? settle(wallet.getBalances(userId)) : null,
        userId ? settle(preferences.get({ userId })) : null,
        userId ? settle(profile.get(userId)) : null,
        // The address and country cannot change within one connection: read once per socket.
        (context.socket.data.region ??= settle(region.visitor({ ip: context.ip, rayId: context.socket.id }))),
        userId ? settle(readExposure(userId)) : null,
      ]);

      const state = {
        at: new Date().toISOString(),
        signedIn: Boolean(userId),
        ...(siteHalf ?? {}),
        ...(area ? { region: area } : {}),
        ...(userId ? { me, profile: record, balances, preferences: prefs, exposure } : {}),
      };

      return { status: true, d: scramble(state, keyFor(context.socket.id)) };
    },
  });
}

module.exports = { register, scramble, keyFor, SALT, invalidateSiteState };

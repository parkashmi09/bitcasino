'use strict';

const { QueryTypes } = require('sequelize');

const { AppError } = require('./errors');
const hubAuth = require('./hubAuth');
const whitelabelPlan = require('./whitelabelPlan');

/**
 * Who is on the other end of the whitelabel hub link (hubAuth), for any service on either side.
 * `box` is the site's secret box (`@ibitplay/auth` createSecretBox) — passed in, not required
 * here, because auth depends on common.
 *
 *   copy side    `parentHub` / `callParent` / `requireParent` — the parent's user-service URL,
 *                this copy's key and secret: what the parent pushed over the link
 *                (whitelabel_settings.hub, sealed), else PARENT_HUB_* env.
 *   parent side  `authenticateCopy` / `whitelabelById` / `callCopy` — the whitelabel a key names
 *                (live only), its sealed secret opened.
 *
 * Every hub route lives under `/api/v1/<service>/wl-hub` on both sides.
 */

const CACHE_MS = 30_000;
let cached = null;

const unauthorized = () => new AppError('Bad hub signature', 401, 'HUB_UNAUTHORIZED');
const notLinked = () => new AppError('This whitelabel is not linked to its parent site yet', 503, 'HUB_NOT_LINKED');
const notFound = () => new AppError('Not found', 404, 'NOT_FOUND');

const select = (db, sql, replacements, transaction) => db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

/** Copy side. `{ url, key, secret }` or null. `url` = the parent's user-service; `serviceUrl` swaps the port per service. */
async function parentHub({ db, config, logger, box }) {
  if (cached && cached.until > Date.now()) return cached.value;
  let value = null;
  try {
    const [row] = await select(db, 'SELECT hub FROM whitelabel_settings WHERE id = 1');
    if (row?.hub?.url && row.hub.key && row.hub.secret) value = { ...row.hub, secret: box.open(row.hub.secret) };
  } catch (error) {
    logger?.warn({ err: error.message }, 'Could not read whitelabel_settings.hub — trying PARENT_HUB_* from env');
  }
  if (!value && config.PARENT_HUB_URL && config.PARENT_HUB_KEY && config.PARENT_HUB_SECRET) {
    value = { url: config.PARENT_HUB_URL, casinoUrl: config.PARENT_HUB_CASINO_URL || null, key: config.PARENT_HUB_KEY, secret: config.PARENT_HUB_SECRET };
  }
  cached = { value, until: Date.now() + CACHE_MS };
  return value;
}

/**
 * Copy side: a signed call to the parent. `service` 'user' (payments) or 'casino'; the parent's
 * casino-service URL is `casinoUrl` when the link names one. Throws HUB_NOT_LINKED or HubError.
 */
async function callParent(deps, method, path, body, { service = 'user', timeoutMs } = {}) {
  const hub = await parentHub(deps);
  if (!hub) throw notLinked();
  const baseUrl = service === 'casino' ? hub.casinoUrl : hub.url;
  if (!baseUrl) throw notLinked();
  return hubAuth.hubRequest({ baseUrl, key: hub.key, secret: hub.secret, direction: 'c2p', method, path: `/api/v1/${service}/wl-hub${path}`, body, timeoutMs });
}

/** Copy side: Express guard for the parent's calls in (p2c, this copy's own key). 404 off a copy. */
function requireParent(deps) {
  return async (req, _res, next) => {
    try {
      if (!deps.config.WHITELABEL_MODE) return next(notFound());
      const hub = await parentHub(deps);
      const ok = hub && req.get('x-hub-key') === hub.key && hubAuth.verifyRequest(req, { secret: hub.secret, direction: 'p2c' });
      return next(ok ? undefined : unauthorized());
    } catch (error) {
      return next(error);
    }
  };
}

const COLUMNS = 'id, slug, name, status, plan, terms, ports, hub_key, hub_secret';

/** Parent side: the whitelabel by id with its secret opened (for calls out to it). */
async function whitelabelById({ db, box }, id, transaction) {
  const [row] = await select(db, `SELECT ${COLUMNS} FROM whitelabels WHERE id = :id`, { id }, transaction);
  if (!row) return null;
  return { ...row, secret: row.hub_secret ? box.open(row.hub_secret) : null };
}

/**
 * Parent side: Express guard for a copy's calls in. Sets `req.whitelabel` = { id, slug, plan,
 * terms, ports }. 404 on a copy: copies are nobody's hub.
 */
function authenticateCopy({ db, config, box }) {
  return async (req, _res, next) => {
    try {
      if (config.WHITELABEL_MODE) return next(notFound());
      const key = req.get('x-hub-key');
      if (typeof key !== 'string' || !/^wlk_[0-9a-f]{24}$/.test(key)) return next(unauthorized());
      const [row] = await select(db, `SELECT ${COLUMNS} FROM whitelabels WHERE hub_key = :key`, { key });
      if (!row || row.status !== 'live' || !row.hub_secret) return next(unauthorized());
      if (!hubAuth.verifyRequest(req, { secret: box.open(row.hub_secret), direction: 'c2p' })) return next(unauthorized());
      req.whitelabel = {
        id: Number(row.id),
        slug: row.slug,
        plan: whitelabelPlan.cleanPlan(row.plan),
        terms: whitelabelPlan.cleanTerms(row.terms),
        ports: row.ports ?? {},
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** Parent side: a signed call to a copy's service on this machine (p2c). `service` = its `ports` key. */
async function callCopy(wl, method, path, body, { service = 'user', timeoutMs } = {}) {
  const port = Number(wl.ports?.[service]);
  if (!port || !wl.secret || !wl.hub_key) throw new hubAuth.HubError(`the whitelabel has no ${service} port or hub key`);
  return hubAuth.hubRequest({
    baseUrl: `http://127.0.0.1:${port}`,
    key: wl.hub_key,
    secret: wl.secret,
    direction: 'p2c',
    method,
    path: `/api/v1/${service}/wl-hub${path}`,
    body,
    timeoutMs,
  });
}

/** Tests: forget the cached copy-side link. */
function resetHubCache() {
  cached = null;
}

module.exports = { parentHub, callParent, requireParent, authenticateCopy, whitelabelById, callCopy, resetHubCache };

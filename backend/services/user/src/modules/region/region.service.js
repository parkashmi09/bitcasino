'use strict';

const { entitlements, regionPolicy } = require('@ibitplay/common');

const { lookupIp, normaliseIp, isPrivateIp } = require('../auth/geoip');

/**
 * Who is restricted, from the owner's region setting and the visitor's address.
 *
 * The country comes ONLY from the offline DB-IP file (`auth/geoip.js`): this runs on a public,
 * unauthenticated route, so no visitor address is ever sent to an online provider from here.
 * A private / loopback address, or one the file cannot place, has no country and is never
 * restricted. `GEOIP_DEV_IP` is ignored here on purpose (it would place localhost somewhere).
 */
class RegionService {
  /**
   * @param {object}   deps
   * @param {object}   [deps.models]         needs `SiteFeature` (the policy row); without it the mode is off
   * @param {Function} [deps.lookupCountry]  `(ip) => { countryCode } | null`; tests only, default the offline file
   */
  constructor({ models, logger, lookupCountry } = {}) {
    this.models = models;
    this.logger = logger;
    this.lookup = lookupCountry ?? ((ip) => lookupIp(ip, { logger }));
  }

  /** `{ mode: 'off'|'notice'|'block', listType, countries }`. Never throws: an unreadable setting is off. */
  async policy() {
    const plan = await entitlements.getEntitlements();
    const { listType, countries } = regionPolicy.cleanRegion(plan.region);
    let mode = 'off';
    try {
      if (entitlements.isFeatureEntitledIn(plan, regionPolicy.FEATURE_KEY) && this.models?.SiteFeature) {
        const row = await this.models.SiteFeature.findByPk(regionPolicy.FEATURE_KEY, { attributes: ['variant'], raw: true });
        mode = regionPolicy.modeOf(row?.variant);
      }
    } catch (error) {
      this.logger?.warn({ err: error.message }, 'Region restriction unreadable — treated as off');
    }
    return { mode, listType, countries };
  }

  /** The visitor's ISO country code, or null (private, loopback, unplaceable, no file). */
  async areaOf(ip) {
    if (!ip || isPrivateIp(ip)) return null;
    try {
      const code = (await this.lookup(ip))?.countryCode ?? null;
      return regionPolicy.isCountryCode(code) ? code : null;
    } catch {
      return null;
    }
  }

  /** What `GET /user/region` answers: `{ restricted, mode, areaCode, ip, rayId }`. */
  async visitor({ ip: rawIp, rayId }) {
    const ip = normaliseIp(rawIp);
    const [policy, areaCode] = await Promise.all([this.policy(), this.areaOf(ip)]);
    return { restricted: regionPolicy.isRestricted(policy, areaCode), mode: policy.mode, areaCode, ip, rayId: rayId ?? null };
  }

  /**
   * `block` mode only: refuse a restricted visitor with `403 REGION_RESTRICTED`. Called by player
   * registration and login (HTTP and socket). Staff login never comes here.
   */
  async assertAllowed(rawIp) {
    const policy = await this.policy();
    if (policy.mode !== 'block') return;
    const areaCode = await this.areaOf(normaliseIp(rawIp));
    if (!regionPolicy.isRestricted(policy, areaCode)) return;
    this.logger?.info({ areaCode, listType: policy.listType }, 'Refused by region restriction');
    throw regionPolicy.regionErrors.RESTRICTED({ areaCode });
  }
}

module.exports = { RegionService };

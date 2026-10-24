'use strict';

/**
 * Region restriction — which countries the site serves. Set by the platform owner only.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHERE THE SETTING LIVES (docs/OWNER-PANEL.md §2, docs/region-restriction.md)
 *
 *   mode       the `region_restriction` POLICY (featureCatalogue.js): its variant is the mode,
 *              applied to `site_features` like every other policy, read-only for staff
 *              (`403 OWNER_MANAGED`). `none` = off (the default), `notice`, `block`.
 *   list type  the document's `region.listType`: `blocklist` (default) or `allowlist`.
 *   countries  the document's `region.countries`: ISO-3166 alpha-2 codes.
 *
 * The owner panel validates and writes `region`; the entitlements store keeps it through `cleanRegion`.
 *
 * ── WHO IS RESTRICTED ───────────────────────────────────────────────────
 *
 * Only a visitor whose country is KNOWN: a private / loopback address or an address the
 * offline GeoIP file cannot place is never restricted (an unknown visitor is let through,
 * like every other fail-open setting from the owner). An empty list restricts nobody, for
 * either list type: an allowlist with no country would close the site to the whole world,
 * which is never what an empty field means.
 *
 * `block` refuses player registration and login with `403 REGION_RESTRICTED`; `notice`
 * only makes the public endpoint say `restricted: true` (the frontend shows its popup).
 * Staff login is never affected.
 * ═════════════════════════════════════════════════════════════════════════
 */

const { defineErrors } = require('./defineErrors');

const FEATURE_KEY = 'region_restriction';

/** The policy's variant keys → the mode the API speaks. */
const MODES = Object.freeze({ none: 'off', notice: 'notice', block: 'block' });
const LIST_TYPES = Object.freeze(['blocklist', 'allowlist']);
const DEFAULT_LIST_TYPE = 'blocklist';

/**
 * Every officially assigned ISO 3166-1 alpha-2 code (249), plus XK (Kosovo): user-assigned in
 * ISO terms, but what GeoIP databases (DB-IP included) answer for it. Mirrored in
 * owner-panel/src/lib/entitlements/region.ts (scripts/region.test.mjs asserts they match).
 */
const COUNTRY_CODES = Object.freeze(
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
   BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
   CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
   DE DJ DK DM DO DZ
   EC EE EG EH ER ES ET
   FI FJ FK FM FO FR
   GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
   HK HM HN HR HT HU
   ID IE IL IM IN IO IQ IR IS IT
   JE JM JO JP
   KE KG KH KI KM KN KP KR KW KY KZ
   LA LB LC LI LK LR LS LT LU LV LY
   MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
   NA NC NE NF NG NI NL NO NP NR NU NZ
   OM
   PA PE PF PG PH PK PL PM PN PR PS PT PW PY
   QA
   RE RO RS RU RW
   SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
   TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
   UA UG UM US UY UZ
   VA VC VE VG VI VN VU
   WF WS
   XK
   YE YT
   ZA ZM ZW`.split(/\s+/)
);
const COUNTRY_SET = new Set(COUNTRY_CODES);

const isCountryCode = (code) => typeof code === 'string' && COUNTRY_SET.has(code);

const errors = defineErrors('REGION', {
  RESTRICTED: {
    status: 403,
    message: 'According to our gaming license regulations, we do not accept players from your region.',
  },
});

/** `{ listType, countries }` from the document: known list type, known codes, upper-case, unique, sorted. */
function cleanRegion(region) {
  const given = region && typeof region === 'object' && !Array.isArray(region) ? region : {};
  const listType = LIST_TYPES.includes(given.listType) ? given.listType : DEFAULT_LIST_TYPE;
  const countries = Array.isArray(given.countries)
    ? [...new Set(given.countries.filter((c) => typeof c === 'string').map((c) => c.trim().toUpperCase()).filter(isCountryCode))].sort()
    : [];
  return { listType, countries };
}

/** The API mode for a stored variant (an unknown or missing one is `off`). */
const modeOf = (variant) => MODES[variant] ?? 'off';

/** Whether a visitor from `areaCode` is restricted under `{ mode, listType, countries }`. */
function isRestricted({ mode, listType, countries }, areaCode) {
  if (mode !== 'notice' && mode !== 'block') return false;
  if (!isCountryCode(areaCode) || !countries?.length) return false;
  const listed = countries.includes(areaCode);
  return listType === 'allowlist' ? !listed : listed;
}

module.exports = {
  FEATURE_KEY,
  MODES,
  LIST_TYPES,
  DEFAULT_LIST_TYPE,
  COUNTRY_CODES,
  isCountryCode,
  cleanRegion,
  modeOf,
  isRestricted,
  regionErrors: errors,
};

/**
 * Countries and dialling codes — the two lists the account form and the signup
 * form both need.
 *
 * `DIAL_CODES` used to live inline in `SignUp.jsx`. It moved here when the
 * account page grew the same `Country Code` select: one list, so the two forms
 * cannot drift into offering different countries for the same field.
 *
 * ## Why the country names are not written out
 *
 * The reference's `Country` select carries every country — Afghanistan through
 * Zimbabwe, ~250 rows. Typing them out is 250 lines of data that the platform
 * already has a canonical source for: `Intl.DisplayNames`, which every browser
 * this app supports ships with the ICU data behind it. So the list below is
 * the ISO 3166-1 alpha-2 CODES, and the names are resolved from them.
 *
 * The locale is pinned to `en`, not left to the visitor's, for the reason
 * `Notifications.formatDate` pins `en-US`: the reference serves one set of
 * names to everyone, and a browser set to `fr` would otherwise render
 * `Allemagne` in this one select and English everywhere else on the page.
 *
 * ## What the backend stores
 *
 * `PUT /user/profile` takes `country` as a free string, `max(100)` — not a
 * code. So the NAME is what goes over the wire and what comes back, which is
 * why `COUNTRIES` is keyed by name at the call site and the code is only an
 * internal key for React.
 */

const ISO_CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT ' +
  'JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY ' +
  'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

/**
 * `[{ code, name }]`, sorted by name — the order the reference's select is in.
 *
 * Built once at module load rather than per render: `Intl.DisplayNames` is
 * cheap to call but not free, and this runs 250 times.
 *
 * A code ICU does not know resolves to the code itself, which would put a bare
 * `XK` in the list. Those are dropped rather than shown, since a two-letter
 * code is not a country name to anyone reading the select.
 */
export const COUNTRIES = (() => {
  let names;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    // No ICU region data. An empty select is wrong, but a select full of
    // two-letter codes is worse; the caller shows the stored value either way.
    return [];
  }

  return ISO_CODES.split(' ')
    .map((code) => ({ code, name: names.of(code) }))
    .filter((entry) => entry.name && entry.name !== entry.code)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
})();

/**
 * The dialling codes the reference's `Country Code` select offers.
 *
 * Fourteen, not 250: the reference's own list is short, and the `label` is the
 * exact string it prints — `BE (+32)`, not `Belgium +32`.
 */
export const DIAL_CODES = [
  { code: '+61', label: 'AU (+61)', country: 'Australia' },
  { code: '+32', label: 'BE (+32)', country: 'Belgium' },
  { code: '+55', label: 'BR (+55)', country: 'Brazil' },
  { code: '+1', label: 'CA (+1)', country: 'Canada' },
  { code: '+49', label: 'DE (+49)', country: 'Germany' },
  { code: '+34', label: 'ES (+34)', country: 'Spain' },
  { code: '+33', label: 'FR (+33)', country: 'France' },
  { code: '+81', label: 'JP (+81)', country: 'Japan' },
  { code: '+82', label: 'KR (+82)', country: 'South Korea' },
  { code: '+31', label: 'NL (+31)', country: 'Netherlands' },
  { code: '+48', label: 'PL (+48)', country: 'Poland' },
  { code: '+351', label: 'PT (+351)', country: 'Portugal' },
  { code: '+46', label: 'SE (+46)', country: 'Sweden' },
  { code: '+44', label: 'UK (+44)', country: 'United Kingdom' },
];

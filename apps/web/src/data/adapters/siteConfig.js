/**
 * `GET /api/v1/admin/site-config/public` -> the flags the UI renders against.
 *
 * ## An absent config reads as ON, on both sides
 *
 * `siteConfig.service.js` answers a full flag set even when no `siteconfig`
 * row exists, with every flag `true` and `configured: false` — an unconfigured
 * deployment shows everything rather than nothing. The client has to default
 * the SAME way, because the alternative is a first paint with every section
 * hidden that fills in a moment later. A home page that assembles itself in
 * front of the player looks broken in a way that an eventually-correct one
 * does not.
 *
 * So `flag()` below answers `true` for anything it has not been told about:
 * an unfetched config, a failed request, and a flag the backend has never
 * heard of all read as ON. Turning a section OFF is the claim that needs
 * evidence.
 *
 * ## Currencies are flags too
 *
 * A currency's flag says the SITE offers it. `backend/.env`'s
 * `SUPPORTED_CURRENCIES` says the WALLET can hold it. The wallet picker needs
 * the intersection — a currency the site advertises but the wallet cannot hold
 * is a dead row in the picker, and one the wallet holds but the site does not
 * advertise is a balance the player cannot act on. `enabledCurrencies()` is
 * that intersection.
 *
 * @see docs/10-backend-integration.md, Phase 1 — "Feature flags".
 */

/**
 * What every flag reads as before the config arrives.
 *
 * Not a copy of the backend's flag list — a single value, applied to any name
 * asked for. Copying the list would mean a flag added upstream defaulted to
 * `undefined` here while defaulting to `true` there, which is exactly the
 * flicker this exists to prevent.
 */
export const FLAG_DEFAULTS = Object.freeze({ flag: true });

/** Only an explicit `false` turns something off. */
const isOff = (value) => value === false || value === 0 || value === '0';

/**
 * Normalise the public config into something with a total `flag()`.
 *
 * @param {object | null | undefined} data The route's `data`, or null.
 * @returns {{
 *   flag: (name: string) => boolean,
 *   amount: (name: string) => string,
 *   enabledCurrencies: (supported: string[]) => string[],
 *   configured: boolean,
 *   raw: object,
 * }}
 */
export function toSiteConfig(data) {
  const raw = data && typeof data === 'object' ? data : {};

  /** Absent, unknown, or not-yet-fetched all read as ON. See the note above. */
  const flag = (name) => !isOff(raw[name]);

  /**
   * A public amount, as the decimal STRING the platform sent.
   *
   * Never parsed. `registerbonus` is `NUMERIC` and these are rates the site
   * advertises; `Number("0.00000000")` renders as `0`, which is a different
   * promise from `0.00000000`.
   */
  const amount = (name) => {
    const value = raw[name];
    return value === null || value === undefined ? '0' : String(value);
  };

  /**
   * The currencies to offer, in the order `supported` gives them.
   *
   * `supported` is the wallet's allow-list; the flags are the site's. Order
   * comes from `supported` because that is the deployment's own preference
   * order (`USDT,BTC,ETH,…`), and an alphabetical picker would put ADA first.
   */
  const enabledCurrencies = (supported) => {
    if (!Array.isArray(supported)) return [];
    return supported.filter((code) => flag(String(code).toLowerCase()));
  };

  return {
    flag,
    amount,
    enabledCurrencies,
    /**
     * Whether a `siteconfig` row actually exists. Not a flag — an operator
     * signal. Nothing player-facing should branch on it; it is here so a
     * staff-facing screen can say "this deployment has never been configured"
     * rather than implying every feature was switched on deliberately.
     */
    configured: raw.configured === true,
    raw,
  };
}

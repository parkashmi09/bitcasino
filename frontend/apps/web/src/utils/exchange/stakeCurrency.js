/* ─── The exchange in the player's own currency ────────────────────────────────────────────
 *
 * mssports books, settles and reports every figure in INR — stakes, limits, exposure, P&L, the
 * open bets. The player, though, picks a wallet in the header (USDT, BTC…), and "1000" on a
 * slip has to mean 1000 of THAT coin. So the exchange pages work in the selected currency and
 * this module is the one boundary between the two:
 *
 *   typed stake (selected coin) ──toInr──▶ what placeBet sends (INR, 2 dp)
 *   every INR figure from the server ──fromInr──▶ what the page prints
 *
 * Pure: the caller hands in the two USD prices (data/usdPrice.js, filled from the platform's
 * exchange-rate table by primeUsdPrices). An unpriced coin falls back to INR — `fallback: true` —
 * rather than sending an unconverted number as rupees.
 *
 * ROUNDING. INR is kept to the paisa (2 dp, half-up). The selected coin is kept to `decimals`:
 * 2 for a fiat or a dollar stablecoin, 6 for anything else (0.000012 BTC is a real stake).
 * Limits are converted INWARD — the minimum rounded UP, the maximum DOWN — so a stake that
 * passes the limits shown also passes the server's INR limits once converted; `stakeToInr`
 * then pins the converted stake into the INR range to absorb the last paisa of rounding.
 */

const TWO_DP = new Set(['USDT', 'USDC', 'USD', 'BUSD', 'DAI', 'TUSD', 'FDUSD']);

/** 'INRFIAT' → 'INR', 'usdt' → 'USDT'; '' / BCD (the site's demo coin) read as INR. */
export function exchangeCode(currencyName) {
  const code = String(currencyName || '').toUpperCase().replace(/FIAT$/, '');
  return !code || code === 'BCD' ? 'INR' : code;
}

const factor = (dp) => 10 ** dp;
const roundTo = (v, dp) => Math.round((Number(v) || 0) * factor(dp) + Number.EPSILON) / factor(dp);
const ceilTo = (v, dp) => Math.ceil(roundTo((Number(v) || 0) * factor(dp), 6)) / factor(dp);
const floorTo = (v, dp) => Math.floor(roundTo((Number(v) || 0) * factor(dp), 6)) / factor(dp);

/** Two significant figures, for a stake chip carried over from INR (1000 ₹ → 12 USDT). */
export function niceStake(v, dp) {
  const n = Number(v) || 0;
  if (n <= 0) return 0;
  const mag = 10 ** (Math.floor(Math.log10(n)) - 1);
  return roundTo(Math.round(n / mag) * mag, dp);
}

/**
 * @param {object} p
 * @param {string} p.currencyName  the header wallet (`session.setting.currencyName`)
 * @param {number} p.usdPrice      USD per 1 unit of that coin
 * @param {number} p.inrUsdPrice   USD per 1 INR
 * @param {string} [p.alias]       ticker to print (getAlias), defaults to the code
 */
export function makeStakeCurrency({ currencyName, usdPrice, inrUsdPrice, alias } = {}) {
  const wanted = exchangeCode(currencyName);
  const rate = Number(usdPrice) / Number(inrUsdPrice); // INR per 1 unit
  const priced = Number.isFinite(rate) && rate > 0;
  const code = wanted !== 'INR' && priced ? wanted : 'INR';
  const isInr = code === 'INR';
  const fallback = wanted !== 'INR' && !priced;
  const decimals = isInr || TWO_DP.has(code) ? 2 : 6;
  const inrPerUnit = isInr ? 1 : rate;
  const label = isInr ? 'INR' : alias || code;

  const toInr = (v) => roundTo((Number(v) || 0) * inrPerUnit, 2);
  const fromInr = (v) => (isInr ? roundTo(v, 2) : roundTo((Number(v) || 0) / inrPerUnit, decimals));

  /** Grouped, `decimals` places, no trailing ".000000" noise beyond 2 places. */
  const format = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return (0).toFixed(2);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals });
  };

  return {
    code,
    label,
    isInr,
    fallback,
    decimals,
    inrPerUnit,
    /** Prefix the kit prints before an amount: ₹ for INR, "USDT " otherwise. */
    prefix: isInr ? '₹' : `${label} `,
    toInr,
    fromInr,
    format,
    /** An INR figure from the server, printed in the selected coin. */
    formatInr: (v) => format(fromInr(v)),
    /** INR limits → the selected coin, rounded inward. */
    limits(minInr, maxInr) {
      const min = minInr == null ? null : isInr ? Number(minInr) : ceilTo(Number(minInr) / inrPerUnit, decimals);
      const max = maxInr == null ? null : isInr ? Number(maxInr) : floorTo(Number(maxInr) / inrPerUnit, decimals);
      return { min, max };
    },
    /** A saved INR chip value, shown as a round number of the selected coin. */
    chipFromInr: (v) => (isInr ? Number(v) : niceStake(Number(v) / inrPerUnit, decimals)),
    /** A chip edited in the selected coin, saved back as whole rupees. */
    chipToInr: (v) => (isInr ? Number(v) : Math.max(1, Math.round(Number(v) * inrPerUnit))),
    /**
     * The typed stake as the INR string placeBet sends. Within the shown limits it is pinned
     * into [minInr, maxInr] so rounding never turns an allowed stake into a refused one.
     */
    stakeToInr(stake, { minInr, maxInr } = {}) {
      const raw = Number(stake) || 0;
      if (isInr) return String(stake ?? '');
      let inr = toInr(raw);
      const shown = this.limits(minInr, maxInr);
      if (minInr != null && shown.min != null && raw >= shown.min && inr < Number(minInr)) inr = Number(minInr);
      if (maxInr != null && Number(maxInr) > 0 && shown.max != null && raw <= shown.max && inr > Number(maxInr)) inr = Number(maxInr);
      return inr.toFixed(2);
    },
    /** Min/max check in the selected coin, so the message names the coin the player typed. */
    checkStake(stake, { minInr, maxInr } = {}) {
      if (isInr) return null;
      const raw = Number(stake) || 0;
      const { min, max } = this.limits(minInr, maxInr);
      if (min != null && raw < min) return `Minimum bet amount is ${format(min)} ${label}`;
      if (max != null && Number(maxInr) > 0 && raw > max) return `Maximum bet amount is ${format(max)} ${label}`;
      return null;
    },
  };
}

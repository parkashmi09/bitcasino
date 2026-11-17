// helper/exposureLimit.mjs — client user ki max exposure (credits.exposure_limit).
//
// Limit sirf direct parent set karta hai (admin POST /admin/exchange/accounts/exposure-limit).
// 0 = koi limit nahi. Exposure negative store hoti hai (200 ki back bet → -200).

var EXPOSURE_LIMIT_EXCEEDED = "Bet Not Confirm Check Exposure Limit And Balance";

/**
 * Is bet ke baad ka total exposure limit se upar gaya?
 * Jo bet exposure KAM karti hai (hedge / cashout) wo kabhi nahi rukti.
 *
 * @param {object} p
 * @param {number|string} p.limit          credits.exposure_limit
 * @param {number|string} p.totalExposure  is bet ke BAAD ka total (TOTAL_EXPOSURE_SQL), negative = liability
 * @param {boolean} p.addsLiability        bet ne exposure badhaya (balanceChange > 0)
 */
var exposureLimitExceeded = ({ limit, totalExposure, addsLiability }) => {
  const max = Number(limit) || 0;
  if (!(max > 0) || !addsLiability) return false;
  const total = Number(totalExposure) || 0;
  const liability = total < 0 ? -total : 0;
  return liability > max + 0.001;
};

export { EXPOSURE_LIMIT_EXCEEDED, exposureLimitExceeded };

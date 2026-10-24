// helper/feedStakeLimit.mjs — the feed's per-bet stake cap when the admin set none.
// TENEXCH's rule (tenexch-new frontend utils/oddsHelpers.js applyMatchOddsLimits, the reference's
// own `iplay ? maxb : umaxbof`), so the page's "Max" and the server's cap are one number (2026-10-21):
//   gtype 'match' quoting umaxbof → in-play: maxb (>0, else max); pre-match: umaxbof.
//     cricket MO pre-match  max 2000 maxb 1 umaxbof 1      → 1 (not open yet — the reference refuses)
//     cricket MO in-play    max 2000 maxb 10000 umaxbof 1  → 10000
//     race pre-off          max 2000 maxb 1 umaxbof 10000  → 10000; in-play → 1 (maxb flag)
//     football in-play      max 0 maxb 100000 umaxbof 1    → 100000
//   every other market (Bookmaker, fancy, line …) → its own max (0 = none; the caller then reads section.max).
// Mirror: frontend/src/utils/exchange/oddsHelpers.js feedMaxStake().
var feedMaxStake = (market) => {
  if (!market) return 0;
  if (market.gtype === "match" && market.umaxbof !== void 0) {
    const inPlay = Number(market.maxb) > 0 ? market.maxb : market.max;
    return Number(market.iplay ? inPlay : market.umaxbof) || 0;
  }
  return Number(market.max) || 0;
};
export { feedMaxStake };

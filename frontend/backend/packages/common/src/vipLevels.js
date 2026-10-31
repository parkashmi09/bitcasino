'use strict';

/**
 * The VIP ladder, keyed on lifetime wager.
 *
 * Lifted verbatim from `legacy/bonus/calculateVip.js` — 75 bands, unchanged
 * boundaries. Extracted rather than retyped, so a transcription slip cannot
 * quietly move a player between levels.
 *
 * ── TWO THINGS THE LEGACY VERSION GOT WRONG ──────────────────────────────
 *
 * 1. IT NAMED THE FIELDS BACKWARDS. `getVipLevelDetails` returned
 *    `vipLevel: nextVip.level` and `previousVipLevel: vip.level` — so the
 *    field called vipLevel was the level the player had NOT reached yet, and
 *    the one they actually held was called previous. Every caller had to know
 *    this, and they did it inconsistently:
 *
 *      parseInt(vipDetails.previousVipLevel?.split(' ')[1]) || 0
 *
 * 2. A PLAYER ABOVE THE TOP BAND FELL TO ZERO. Past 99,999,999,999 the function
 *    returned `{ error: ... }` with no level field at all. The caller's
 *    `parseInt(undefined) || 0` then made them VIP 0 — so the platform's very
 *    biggest player would silently lose every bonus they qualified for. Here the
 *    top band is open-ended.
 */

/** Lifetime wager bands. `maxXp` on the final band is ignored — see below. */
const VIP_LEVELS = Object.freeze([
  { level:  1, minXp:           1, maxXp:          99, card: 'brownz' },
  { level:  2, minXp:         100, maxXp:         199, card: 'brownz' },
  { level:  3, minXp:         200, maxXp:         999, card: 'brownz' },
  { level:  4, minXp:        1000, maxXp:        1999, card: 'brownz' },
  { level:  5, minXp:        2000, maxXp:        2999, card: 'brownz' },
  { level:  6, minXp:        3000, maxXp:        3999, card: 'brownz' },
  { level:  7, minXp:        4000, maxXp:        4999, card: 'brownz' },
  { level:  8, minXp:        5000, maxXp:        6999, card: 'silver' },
  { level:  9, minXp:        7000, maxXp:        8999, card: 'silver' },
  { level: 10, minXp:        9000, maxXp:       10999, card: 'silver' },
  { level: 11, minXp:       11000, maxXp:       12999, card: 'silver' },
  { level: 12, minXp:       13000, maxXp:       14999, card: 'silver' },
  { level: 13, minXp:       15000, maxXp:       16999, card: 'silver' },
  { level: 14, minXp:       17000, maxXp:       18999, card: 'silver' },
  { level: 15, minXp:       19000, maxXp:       20999, card: 'silver' },
  { level: 16, minXp:       21000, maxXp:       22999, card: 'silver' },
  { level: 17, minXp:       23000, maxXp:       24999, card: 'silver' },
  { level: 18, minXp:       25000, maxXp:       26999, card: 'silver' },
  { level: 19, minXp:       27000, maxXp:       28999, card: 'silver' },
  { level: 20, minXp:       29000, maxXp:       30999, card: 'silver' },
  { level: 21, minXp:       31000, maxXp:       44999, card: 'silver' },
  { level: 22, minXp:       45000, maxXp:       48999, card: 'gold' },
  { level: 23, minXp:       49000, maxXp:       58999, card: 'gold' },
  { level: 24, minXp:       59000, maxXp:       68999, card: 'gold' },
  { level: 25, minXp:       69000, maxXp:       78999, card: 'gold' },
  { level: 26, minXp:       79000, maxXp:       88999, card: 'gold' },
  { level: 27, minXp:       89000, maxXp:       98999, card: 'gold' },
  { level: 28, minXp:       99000, maxXp:      108999, card: 'gold' },
  { level: 29, minXp:      109000, maxXp:      118999, card: 'gold' },
  { level: 30, minXp:      119000, maxXp:      128999, card: 'gold' },
  { level: 31, minXp:      129000, maxXp:      138999, card: 'gold' },
  { level: 32, minXp:      139000, maxXp:      148999, card: 'gold' },
  { level: 33, minXp:      149000, maxXp:      158999, card: 'gold' },
  { level: 34, minXp:      159000, maxXp:      168999, card: 'gold' },
  { level: 35, minXp:      169000, maxXp:      178999, card: 'gold' },
  { level: 36, minXp:      179000, maxXp:      188999, card: 'gold' },
  { level: 37, minXp:      189000, maxXp:      296999, card: 'gold' },
  { level: 38, minXp:      297000, maxXp:      320999, card: 'platinum' },
  { level: 39, minXp:      321000, maxXp:      376999, card: 'platinum' },
  { level: 40, minXp:      377000, maxXp:      432999, card: 'platinum' },
  { level: 41, minXp:      433000, maxXp:      488999, card: 'platinum' },
  { level: 42, minXp:      489000, maxXp:      544999, card: 'platinum' },
  { level: 43, minXp:      545000, maxXp:      600999, card: 'platinum' },
  { level: 44, minXp:      601000, maxXp:      656999, card: 'platinum' },
  { level: 45, minXp:      657000, maxXp:      712999, card: 'platinum' },
  { level: 46, minXp:      713000, maxXp:      768999, card: 'platinum' },
  { level: 47, minXp:      769000, maxXp:      824999, card: 'platinum' },
  { level: 48, minXp:      825000, maxXp:      880999, card: 'platinum' },
  { level: 49, minXp:      881000, maxXp:      936999, card: 'platinum' },
  { level: 50, minXp:      937000, maxXp:      992999, card: 'platinum' },
  { level: 51, minXp:      993000, maxXp:     1048999, card: 'platinum' },
  { level: 52, minXp:     1049000, maxXp:     1104999, card: 'platinum' },
  { level: 53, minXp:     1105000, maxXp:     1160999, card: 'platinum' },
  { level: 54, minXp:     1161000, maxXp:     1216999, card: 'platinum' },
  { level: 55, minXp:     1217000, maxXp:     1272999, card: 'platinum' },
  { level: 56, minXp:     1273000, maxXp:     2368999, card: 'platinum' },
  { level: 57, minXp:     2369000, maxXp:     2656999, card: 'platinum' },
  { level: 58, minXp:     2657000, maxXp:     2944999, card: 'platinum' },
  { level: 59, minXp:     2945000, maxXp:     3232999, card: 'platinum' },
  { level: 60, minXp:     3233000, maxXp:     3520999, card: 'platinum' },
  { level: 61, minXp:     3521000, maxXp:     3808999, card: 'platinum' },
  { level: 62, minXp:     3809000, maxXp:     4096999, card: 'platinum' },
  { level: 63, minXp:     4097000, maxXp:     4384999, card: 'platinum' },
  { level: 64, minXp:     4385000, maxXp:     4672999, card: 'platinum' },
  { level: 65, minXp:     4673000, maxXp:     4960999, card: 'platinum' },
  { level: 66, minXp:     4961000, maxXp:     5249999, card: 'platinum' },
  { level: 67, minXp:     5250000, maxXp:     5537999, card: 'platinum' },
  { level: 68, minXp:     5538000, maxXp:     8576999, card: 'platinum' },
  { level: 69, minXp:     8577000, maxXp:     9216999, card: 'platinum' },
  { level: 70, minXp:     9217000, maxXp: 10872832999, card: 'diamond' },
  { level: 71, minXp: 10872833000, maxXp: 12058624999, card: 'diamond' },
  { level: 72, minXp: 12058625000, maxXp: 13058624999, card: 'diamond' },
  { level: 73, minXp: 13058625000, maxXp: 14058624999, card: 'diamond' },
  { level: 74, minXp: 14058625000, maxXp: 15058624999, card: 'diamond' },
  { level: 75, minXp: 15058625000, maxXp: 99999999999, card: 'diamond' },
]);

const TOP = VIP_LEVELS[VIP_LEVELS.length - 1];

/**
 * Which VIP level a lifetime wager buys.
 *
 * Takes a decimal STRING, not a number. The top bands run to eleven digits and
 * wagers carry eight decimal places, which together exceed what a double
 * represents exactly — comparing them as numbers puts players on the wrong side
 * of a boundary. `Number` is used only after the band is chosen, for the
 * progress percentage, where a rounding error is cosmetic.
 *
 * Below the first band is VIP 0: a player who has never wagered.
 *
 * Above the last band stays at the top level rather than falling off the end.
 */
function vipLevelFor(wager) {
  const amount = Number.parseFloat(String(wager ?? '0').replace(/,/g, '')) || 0;

  if (amount < Number(VIP_LEVELS[0].minXp)) {
    return {
      level: 0,
      card: 'brownz',
      wager: String(wager ?? '0'),
      nextLevel: VIP_LEVELS[0].level,
      wagerToNextLevel: String(VIP_LEVELS[0].minXp),
      progressPct: '0.00',
    };
  }

  // Open-ended at the top. Legacy returned an error object here, and its
  // callers turned that into VIP 0.
  if (amount >= Number(TOP.minXp)) {
    return {
      level: TOP.level,
      card: TOP.card,
      wager: String(wager ?? '0'),
      nextLevel: null,
      wagerToNextLevel: null,
      progressPct: '100.00',
    };
  }

  const index = VIP_LEVELS.findIndex((v) => amount >= Number(v.minXp) && amount <= Number(v.maxXp));
  const band = VIP_LEVELS[index];
  const next = VIP_LEVELS[index + 1] ?? null;

  const span = Number(band.maxXp) - Number(band.minXp) + 1;
  const into = amount - Number(band.minXp);

  return {
    level: band.level,
    card: band.card,
    wager: String(wager ?? '0'),
    nextLevel: next ? next.level : null,
    wagerToNextLevel: next ? String(Number(band.maxXp) - amount + 1) : null,
    progressPct: ((into / span) * 100).toFixed(2),
  };
}

module.exports = { VIP_LEVELS, vipLevelFor };

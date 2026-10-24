'use strict';

/**
 * The house edge, from `legacy/config.js`:
 *
 *     let house = 2; // HoseEdge
 *
 * Applied by `Rule.prepareBusted` as `(house / 100) * amount` deducted from the
 * returned stake. Unchanged.
 */
const HOUSE_EDGE_PERCENT = 2;

/**
 * The wallet column a coin plays on.
 *
 * A map, not a string. Legacy's `_.lowerCase(coin)` was interpolated straight
 * into `UPDATE credits SET ${coin} = ${coin} - $2` — `_.lowerCase` formats, it
 * does not sanitise.
 */
const COIN_COLUMNS = Object.freeze({
  BTC: 'btc', ETH: 'eth', LTC: 'ltc', BCH: 'bch', USDT: 'usdt', TRX: 'trx',
  DOGE: 'doge', ADA: 'ada', XRP: 'xrp', BNB: 'bnb', USDP: 'usdp', NEXO: 'nexo',
  MKR: 'mkr', TUSD: 'tusd', USDC: 'usdc', BUSD: 'busd', INR: 'inr',
  SHIB: 'shib', MATIC: 'matic', SC: 'sc', MVR: 'mvr', BJB: 'bjb', AED: 'aed',
  NPR: 'npr', PKR: 'pkr', EUR: 'eur', BDT: 'bdt',
});

/**
 * Coins that never reach the real money path.
 *
 * `nc` is play money — legacy short-circuits it in `Agent.getBank` and in the
 * tip and rain checks.
 */
const PLAY_COIN_BLOCKED = Object.freeze(['NC']);

/**
 * The games, keyed by the value written to `bets.game`.
 *
 * Those strings are an API contract with every historical row and every client.
 */
const GAMES = Object.freeze([
  'crash', 'classic_dice', 'hash_dice', 'limbo', 'keno', 'single_keno',
  'hilo', 'highlow', 'wheel', 'magic_wheel', 'plinko', 'mine', 'tower',
  'diamond', 'goal', 'roulette', 'blackjack', 'videopoker',
  'three_card_monte', 'snake_and_ladders',
]);

/**
 * The Crash round phases, from `legacy/Games/Crash/index.js`:
 *
 *     wait  → H.wait(5000)         → start
 *     start → H.wait(crashTimeout) → bust
 *     bust  → H.wait(5000)         → wait
 */
const WAITING_MS = 5000;
const BUSTED_MS = 5000;

/**
 * A ceiling on how long one Crash round may run.
 *
 * `Result.calculateTimeout` is unbounded — a bust point of 1000 is about 115
 * seconds and the distribution has no upper limit, so a rare draw could run for
 * hours with every stake locked in it. Legacy had no cap.
 */
const MAX_ROUND_MS = 5 * 60_000;

/** Keno's phases. Legacy's `roundTime` with the reveal timers folded in. */
const KENO_WAITING_MS = 15_000;
const KENO_DRAW_MS = 3000;
const KENO_BUSTED_MS = 5000;

module.exports = {
  HOUSE_EDGE_PERCENT,
  COIN_COLUMNS,
  PLAY_COIN_BLOCKED,
  GAMES,
  WAITING_MS,
  BUSTED_MS,
  MAX_ROUND_MS,
  KENO_WAITING_MS,
  KENO_DRAW_MS,
  KENO_BUSTED_MS,
};

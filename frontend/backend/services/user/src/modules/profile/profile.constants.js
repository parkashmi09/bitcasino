'use strict';

/**
 * The in-house games.
 *
 * `Rule.getGamesList` is `return callback(games)` — a module-level constant in
 * `Users/Rule.js`, not a query. There is no `games` table in the schema and
 * there never was, so this is data, not a read.
 *
 * The keys are what `C.PLAY_*` events and `bets.game` use, so they are an API
 * contract with every client and with every historical row.
 */
const IN_HOUSE_GAMES = Object.freeze([
  { key: 'crash', name: 'Crash' },
  { key: 'classic_dice', name: 'Classic Dice' },
  { key: 'hash_dice', name: 'Hash Dice' },
  { key: 'limbo', name: 'Limbo' },
  { key: 'keno', name: 'Keno' },
  { key: 'single_keno', name: 'Single Keno' },
  { key: 'hilo', name: 'HiLo' },
  { key: 'highlow', name: 'High Low' },
  { key: 'wheel', name: 'Wheel' },
  { key: 'magic_wheel', name: 'Magic Wheel' },
  { key: 'plinko', name: 'Plinko' },
  { key: 'mine', name: 'Mines' },
  { key: 'tower', name: 'Tower' },
  { key: 'diamond', name: 'Diamond' },
  { key: 'goal', name: 'Goal' },
  { key: 'roulette', name: 'Roulette' },
  { key: 'blackjack', name: 'Blackjack' },
  { key: 'videopoker', name: 'Video Poker' },
  { key: 'three_card_monte', name: 'Three Card Monte' },
  { key: 'snake_and_ladders', name: 'Snake and Ladders' },
]);

module.exports = { IN_HOUSE_GAMES };

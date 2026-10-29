'use strict';

const STATUS = Object.freeze({ ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED' });

/** The in-house games a challenge can be set on (`in-house/inHouse.constants.js` keys). */
const IN_HOUSE_GAMES = Object.freeze([
  { key: 'classic_dice', name: 'Dice' },
  { key: 'limbo', name: 'Limbo' },
  { key: 'crash', name: 'Crash' },
  { key: 'plinko', name: 'Plinko' },
  { key: 'mine', name: 'Mines' },
  { key: 'keno', name: 'Keno' },
  { key: 'wheel', name: 'Wheel' },
  { key: 'tower', name: 'Tower' },
  { key: 'hilo', name: 'Hilo' },
  { key: 'roulette', name: 'Roulette' },
  { key: 'blackjack', name: 'Blackjack' },
]);

const RATES_TTL_MS = 60_000;

/** A winner's name on the public page: the first four letters. */
const NAME_SHOWN = 4;

module.exports = { STATUS, IN_HOUSE_GAMES, RATES_TTL_MS, NAME_SHOWN };

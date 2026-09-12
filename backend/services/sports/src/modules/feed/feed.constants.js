'use strict';

/**
 * Display names for the provider's sport ids.
 *
 * A literal object inside `sportsapiallmatchescontroller.js` in legacy, so
 * every other controller that returned a sport id returned it without a name.
 * Stated once.
 */
const SPORT_NAMES = Object.freeze({
  1: 'Soccer',
  2: 'Tennis',
  3: 'Golf',
  4: 'Cricket',
  5: 'Rugby Union',
  6: 'Boxing',
  7: 'Horse Racing',
  8: 'Motor Sport',
  13: 'Horse Race Todays Card',
  15: 'Greyhound Todays Card',
  1477: 'Rugby League',
  3503: 'Darts',
  4339: 'Greyhound Racing',
  6422: 'Snooker',
  6423: 'American Football',
  7511: 'Baseball',
  7522: 'Basketball',
  2152880: 'Gaelic Games',
  26420387: 'Mixed Martial Arts',
});

/**
 * The `:dateType` values the fixture endpoints accept.
 *
 * Legacy's `getRange` returned `null` for anything it did not recognise, and
 * the caller then treated `null` as "no filter" — so `/matches-by-date/yesterday`
 * quietly returned every fixture on the board instead of refusing.
 */
const DATE_RANGES = Object.freeze({
  today: { offsetDays: 0, spanDays: 1 },
  tomorrow: { offsetDays: 1, spanDays: 1 },
});

/**
 * Which day "today" means.
 *
 * Legacy hardcoded `utcOffset(330)` — IST as a fixed number of minutes — in a
 * file that read `process.env.APP_TZ` two lines earlier and never used it. A
 * fixed offset also cannot follow daylight saving, which several of the
 * competitions on this board observe.
 */
const FEED_TIMEZONE = 'Asia/Kolkata';

module.exports = { SPORT_NAMES, DATE_RANGES, FEED_TIMEZONE };

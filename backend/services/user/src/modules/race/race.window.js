'use strict';

/**
 * Where a race window starts and ends.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE TIMEZONE IS A PARAMETER, NOT FIVE LITERALS
 *
 * The implementation this is ported from hardcoded `Asia/Kolkata` in five
 * places — a minute offset constant, three cron schedules, and the front end's
 * "what time is it there" helper — with nothing tying them together. Changing
 * the operator's day meant finding all five, and missing one produced a race
 * whose window and whose settlement ran on different days.
 *
 * It is `RACE_TIMEZONE` in the service config now, read once and passed in.
 *
 * ── AND IT IS COMPUTED, NOT ASSUMED ──────────────────────────────────────
 *
 * The reference added a fixed `+330` minutes. That is right for India and
 * wrong for any zone that observes daylight saving: two days a year the window
 * would be an hour out, and a race would either lose an hour of bets or count
 * an hour of the next one's. `Intl.DateTimeFormat` knows the real offset for a
 * given instant, so the arithmetic below works in any zone.
 * ═════════════════════════════════════════════════════════════════════════
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The zone's UTC offset, in minutes, at a particular instant. */
function offsetMinutesAt(instant, timeZone) {
  /**
   * `formatToParts` in the target zone, reassembled as if it were UTC. The gap
   * between that and the real instant IS the offset — which is how you get a
   * zone's offset without a timezone database of your own.
   */
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const at = {};
  for (const { type, value } of parts) if (type !== 'literal') at[type] = Number(value);

  // `hour` comes back as 24 at midnight under some ICU versions; 24:00 today
  // is 00:00 today for this purpose, and Date.UTC would roll it into tomorrow.
  const hour = at.hour === 24 ? 0 : at.hour;

  const asUtc = Date.UTC(at.year, at.month - 1, at.day, hour, at.minute, at.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The local calendar date at `instant`, as `{year, month, day}` (month 1-12). */
function localDateAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const [year, month, day] = parts.split('-').map(Number);
  return { year, month, day };
}

/**
 * The UTC instant of local midnight on a given local date.
 *
 * Done twice: the first pass guesses the offset using the offset at midday
 * (never inside a DST transition), the second corrects using the offset that
 * actually applies at the answer. One pass is wrong on the two days a year a
 * zone shifts.
 */
function localMidnightUtc({ year, month, day }, timeZone) {
  const midday = Date.UTC(year, month - 1, day, 12, 0, 0);
  const guess = Date.UTC(year, month - 1, day) - offsetMinutesAt(new Date(midday), timeZone) * 60_000;
  const corrected = Date.UTC(year, month - 1, day) - offsetMinutesAt(new Date(guess), timeZone) * 60_000;
  return new Date(corrected);
}

/**
 * Which local day of the week an instant falls on. 0 = Monday.
 *
 * Monday-based because the weekly race runs Monday to Monday, and JavaScript's
 * Sunday-based `getUTCDay` makes that arithmetic read backwards.
 */
function localWeekdayAt(instant, timeZone) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
}

/**
 * The race window containing `instant`.
 *
 * Half-open — `>= startsAt`, `< endsAt` — so a bet placed on the boundary
 * belongs to exactly one race. The reference queried `BETWEEN`, which is closed
 * at both ends, and a bet at the stroke of midnight scored in two races.
 *
 * @param {'daily'|'weekly'} type
 * @param {Date} instant
 * @param {string} timeZone
 * @returns {{startsAt: Date, endsAt: Date}}
 */
function windowFor(type, instant, timeZone) {
  const today = localDateAt(instant, timeZone);
  const midnight = localMidnightUtc(today, timeZone);

  if (type === 'daily') {
    /**
     * Not `midnight + 24h`: a day that gains or loses an hour to DST is 23 or
     * 25 hours long, and adding a fixed day would leave a gap or an overlap
     * between consecutive races. Tomorrow's local midnight is the real end.
     */
    const tomorrow = localDateAt(new Date(midnight.getTime() + DAY_MS + DAY_MS / 2), timeZone);
    return { startsAt: midnight, endsAt: localMidnightUtc(tomorrow, timeZone) };
  }

  // Weekly: back up to this local week's Monday, forward to the next.
  const weekday = localWeekdayAt(instant, timeZone);
  const monday = localDateAt(new Date(midnight.getTime() - weekday * DAY_MS + DAY_MS / 2), timeZone);
  const startsAt = localMidnightUtc(monday, timeZone);
  const nextMonday = localDateAt(new Date(startsAt.getTime() + 7 * DAY_MS + DAY_MS / 2), timeZone);

  return { startsAt, endsAt: localMidnightUtc(nextMonday, timeZone) };
}

module.exports = { windowFor, localMidnightUtc, localDateAt, localWeekdayAt, offsetMinutesAt, DAY_MS };

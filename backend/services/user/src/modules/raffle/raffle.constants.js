'use strict';

/**
 * The draw clock: every Sunday 00:00 UTC, numbered from the reference's "Draw #95" on
 * 2026-10-04 — the same rule the player site counts down with (`raffleDraw.js`).
 */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ANCHOR_DRAW = 95;
const ANCHOR_TIME = Date.UTC(2026, 9, 4);

const DRAW_STATUS = Object.freeze({ OPEN: 'OPEN', DRAWN: 'DRAWN' });
const TICKET_SOURCE = Object.freeze({ FREE: 'FREE', WAGER: 'WAGER' });

/** Seven-digit ticket numbers, as the reference prints them. */
const TICKET_MIN = 1_000_000;
const TICKET_MAX = 9_999_999;

/** A winner's name on the public results: the first four letters, as the reference's "Yamu...". */
const NAME_SHOWN = 4;

/** The ledger reason a prize is credited under (the race's `race_reward_claim`, for the raffle). */
const REASON = Object.freeze({ PRIZE: 'raffle_prize' });

module.exports = { REASON, WEEK_MS, ANCHOR_DRAW, ANCHOR_TIME, DRAW_STATUS, TICKET_SOURCE, TICKET_MIN, TICKET_MAX, NAME_SHOWN };

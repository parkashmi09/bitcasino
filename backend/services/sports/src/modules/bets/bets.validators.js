'use strict';

const { z } = require('@ibitplay/common');

const { BET_STATUS } = require('./bets.constants');

const providerId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, 'is not a valid provider id');

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Money as a string.
 *
 * NOT used by `place` — the ported handler takes the stake as the board sends
 * it and does `Number(stake_amount)` on it, floats and all, because that is
 * what `legacy/sportsmain/API/controller.js` does and settlement reads the
 * numbers it wrote. Kept and exported because the admin and settlement
 * validators build on it, and because it is the shape a stake SHOULD arrive
 * in: every rounding error in `stake * (odds - 1)` on an IEEE-754 double,
 * compared against a balance and then stored, is somebody's money.
 */
const amount = z
  .string({ invalid_type_error: 'send the stake as a string, not a number' })
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'must be a positive decimal with at most 8 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'stake must be greater than zero');

/**
 * A price. Also not used by `place` — see `amount`.
 *
 * Bounded above because it goes into a payout calculation: an unbounded price
 * is an unbounded liability, and legacy accepted whatever arrived. On the
 * place-bet path that bound now comes from the odds guard comparing against
 * the cached book rather than from this schema.
 */
const odds = z
  .string({ invalid_type_error: 'send the odds as a string, not a number' })
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, 'must be a decimal with at most 4 decimal places')
  .refine((v) => Number.parseFloat(v) > 1, 'odds must be greater than 1')
  .refine((v) => Number.parseFloat(v) <= 1000, 'odds above 1000 are not accepted');

/**
 * Placing a bet — the legacy payload, as `POST /api/sportsmain/place-bet`
 * took it.
 *
 * ── THIS SCHEMA DELIBERATELY REFUSES ALMOST NOTHING ──────────────────────
 *
 * The legacy handler validated NONE of this: it destructured twenty-six fields
 * straight off `req.body` and let the arithmetic fail into its catch. The
 * service is a verbatim port of that handler, so the schema has to let the
 * same payloads through — `.passthrough()`, everything optional, no coercion.
 * Numbers stay numbers because the exposure maths is `Number(stake_amount)`
 * and `Number(odds)` on floats, exactly as it was.
 *
 * The fields are named rather than left implicit so the shape the board posts
 * is written down somewhere. `user_id` is listed and IGNORED — the service
 * takes the player from the token. Legacy read it from here, on an
 * unauthenticated route, which is how one account placed bets against
 * another's wallet.
 */
const place = {
  body: z
    .object({
      // What the bet is on.
      match_id: z.union([z.string(), z.number()]).optional(),
      market_id: z.union([z.string(), z.number()]).optional(),
      eventid: z.union([z.string(), z.number()]).optional(),
      event_id: z.union([z.string(), z.number()]).optional(),
      sid: z.union([z.string(), z.number()]).optional(),
      selection_id: z.union([z.string(), z.number()]).optional(),

      // How the market is classified. `market_type` picks the exposure branch.
      game_type: z.string().optional(),
      market_type: z.string().optional(),
      mname: z.string().optional(),
      gtype: z.string().optional(),

      // The selection and the price.
      selection_name: z.string().optional(),
      nat: z.string().optional(),
      bet_type: z.string().optional(),
      odds: z.union([z.string(), z.number()]).optional(),
      stake_amount: z.union([z.string(), z.number()]).optional(),
      size: z.union([z.string(), z.number()]).nullish(),
      lay_size: z.union([z.string(), z.number()]).nullish(),
      back_size: z.union([z.string(), z.number()]).nullish(),
      runner_odds: z.array(z.any()).optional(),
      unmatched: z.boolean().optional(),
      unmatched_odds: z.union([z.string(), z.number()]).nullish(),

      // Everything the bet ROW carries. All of it is written as sent.
      match_title: z.string().optional(),
      event_name: z.string().optional(),
      team_one: z.string().optional(),
      team_two: z.string().optional(),
      runners: z.array(z.any()).optional(),
      count: z.union([z.string(), z.number()]).optional(),
      category: z.union([z.string(), z.number()]).optional(),
      fancy_name: z.string().optional(),
      match_start_time: z.union([z.string(), z.date()]).nullish(),
      original_currency: z.string().optional(),
      original_amount: z.union([z.string(), z.number()]).optional(),
      usd_amount: z.union([z.string(), z.number()]).nullish(),
      section: z.union([z.string(), z.array(z.any())]).optional(),

      // Accepted and ignored — the player comes from the token.
      user_id: z.union([z.string(), z.number()]).optional(),
    })
    .passthrough(),
};

const matchParam = { params: z.object({ matchId: providerId }) };

const history = {
  query: paging.extend({
    matchId: providerId.optional(),
    status: z.enum(Object.values(BET_STATUS)).optional(),
  }),
};

const exposures = { query: z.object({ matchId: providerId.optional() }) };

module.exports = { place, matchParam, history, exposures, amount, odds, providerId };

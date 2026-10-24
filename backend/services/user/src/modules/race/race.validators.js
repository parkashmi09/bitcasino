'use strict';

const { z } = require('@ibitplay/common');

const { RACE_TYPES, MAX_WINNERS } = require('./race.constants');

const raceType = z.enum(RACE_TYPES);
const id = z.coerce.number().int().positive();

/** A points multiplier. Zero is legitimate — it excludes a bucket from scoring. */
const multiplier = z.coerce.number().min(0).max(1_000);
const percent = z.coerce.number().min(0).max(100);

/**
 * A money amount as a string.
 *
 * A string, not a number: `0.1 + 0.2` is the reason every money field on this
 * platform travels as a decimal string, and a prize pool is money.
 */
const amount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,12}(\.\d{1,8})?$/.test(v), 'must be a positive decimal amount');

const seatRank = z.coerce.number().int().min(1).max(MAX_WINNERS);

const typeParam = { params: z.object({ type: raceType }) };

const listing = {
  query: z
    .object({
      type: raceType.optional(),
      /** `true` for unclaimed only, `false` for claimed only, absent for both. */
      claimed: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict(),
};

const adminListing = {
  query: z
    .object({
      type: raceType.optional(),
      userId: id.optional(),
      raceId: id.optional(),
      claimed: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict(),
};

/** Public finished-race list: newest first, a page's worth. */
const history = {
  query: z
    .object({
      type: raceType.optional(),
      limit: z.coerce.number().int().min(1).max(30).default(10),
    })
    .strict(),
};

/** Cancel: an optional reason, kept on the race and in the audit row. */
const cancel = {
  params: z.object({ id }),
  body: z.object({ reason: z.string().trim().max(200).optional() }).strict(),
};

/** A staff test race: its own window instead of midnight→midnight / Monday→Monday. */
const testRace = {
  body: z.object({ type: raceType, startsAt: z.coerce.date(), endsAt: z.coerce.date() }).strict(),
};

const rewardParam = { params: z.object({ rewardId: id }) };

const updateConfig = {
  params: z.object({ type: raceType }),
  body: z
    .object({
      enabled: z.coerce.boolean().optional(),

      sportsPoints: multiplier.optional(),
      casinoPoints: multiplier.optional(),
      slotPoints: multiplier.optional(),
      crashPoints: multiplier.optional(),
      /**
       * The fall-through bucket. Declared like any other, because the games it
       * catches — roulette, table games, anything whose type the catalogue does
       * not spell out — are real turnover and somebody has to decide what they
       * are worth.
       */
      otherPoints: multiplier.optional(),

      prizePool: amount.optional(),
      platformFeePercent: percent.optional(),
      winnerCount: z.coerce.number().int().min(1).max(MAX_WINNERS).optional(),
      top3Percentage: percent.optional(),
      minPoints: amount.optional(),

      bookedSeatsEnabled: z.coerce.boolean().optional(),
      /**
       * Ranks reserved for decorative entries. Bounded by `MAX_WINNERS` here
       * and filtered against the saved `winner_count` on write — a seat booked
       * at rank 40 of a 25-rank race is a seat that can never be filled, and
       * silently keeping it makes the boat placement loop look broken.
       */
      bookedSeats: z
        .array(
          z.union([
            seatRank,
            // A rank pinned to one boat; a plain number is any free boat (the older, stored form).
            z.object({ rank: seatRank, boatId: id }).strict(),
          ])
        )
        .max(MAX_WINNERS)
        .optional(),

      /**
       * The operator's own payout ladder: % of the net pool per rank, rank 1 first. Sets the
       * ranks paid to its length. `resetLadder: true` goes back to the computed curve.
       */
      rankShares: z.array(z.coerce.number().gt(0).max(100)).min(1).max(MAX_WINNERS).optional(),
      resetLadder: z.boolean().optional(),
    })
    .strict()
    /**
     * An empty body is almost always a client bug — a form that serialised
     * nothing — and answering 200 with the config unchanged hides it.
     */
    .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' }),
};

const boat = z.object({
  name: z.string().trim().min(1).max(60),
  isActive: z.coerce.boolean().optional(),
}).strict();

const addBoat = { body: boat.strict() };
const updateBoat = { params: z.object({ id }), body: boat.partial().strict() };
const boatParam = { params: z.object({ id }) };

module.exports = {
  typeParam,
  listing,
  history,
  adminListing,
  rewardParam,
  cancel,
  testRace,
  updateConfig,
  addBoat,
  updateBoat,
  boatParam,
};

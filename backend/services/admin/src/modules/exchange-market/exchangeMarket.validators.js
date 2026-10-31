'use strict';

const { z } = require('@ibitplay/common');

// event / market ids feed ke hain (lambe numbers) — string hi rakho
const feedId = z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,64}$/, 'invalid id');

/** GET /exchange/market/analysis — eventId do to sirf wo event (Game Details). */
const analysis = {
  query: z.object({ eventId: feedId.optional() }).strict(),
};

/** GET /exchange/market/user-book — ek market ka per-user book. */
const userBook = {
  query: z
    .object({
      eventId: feedId,
      gameType: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
};

/** GET /exchange/market/event-bets — ek event ki downline bets (My Bets / View More). */
const eventBets = {
  query: z
    .object({
      eventId: feedId,
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })
    .strict(),
};

/** GET /exchange/market/current-bets — zip ka Current Bets report. */
const currentBets = {
  query: z
    .object({
      matchStatus: z.enum(['matchbet', 'unsettled', 'deletebet']).default('matchbet'),
      betType: z.enum(['all', 'back', 'lay']).default('all'),
      // Direct Users | Agent Users tab; na ho = dono
      channel: z.enum(['direct', 'agent']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(25),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict(),
};

module.exports = { analysis, userBook, eventBets, currentBets };

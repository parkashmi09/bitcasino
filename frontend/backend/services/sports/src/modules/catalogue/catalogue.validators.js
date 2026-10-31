'use strict';

const { z } = require('@ibitplay/common');

const id = z.coerce.number().int().positive();

/** Provider ids travel as strings and land in URLs and WHERE clauses. */
const providerId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, 'is not a valid provider id');

const name = z.string().trim().min(1).max(255);

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Sports ─────────────────────────────────────────────────────────────

const listSports = {
  query: z.object({ enabledOnly: z.coerce.boolean().optional() }),
};

const sportParam = { params: z.object({ id }) };

/**
 * A sport id, as `sports_config.game_id` actually stores it.
 *
 * That column is INTEGER, not text — unlike `admin_fancy_control.event_id` and
 * `.market_id`, which are the provider's strings. The provider's SPORT ids
 * happen to all be numeric (`4` for cricket, `26420387` for MMA), which is why
 * the column works, but it means a non-numeric value is a Postgres type error
 * rather than an empty result. Caught here instead.
 */
const sportGameId = z.coerce.number().int().positive();

const addSport = {
  body: z
    .object({
      gameId: sportGameId,
      gameName: name,
      // Legacy required `typeof enabled === 'boolean'` on create and rejected
      // the request without it. Defaulted instead: a newly configured sport is
      // OFF until somebody turns it on, which is the safe direction.
      enabled: z.boolean().default(false),
    })
    .strict(),
};

const updateSport = {
  params: z.object({ id }),
  body: z
    .object({ gameName: name.optional(), enabled: z.boolean().optional() })
    .strict()
    .refine((v) => v.gameName !== undefined || v.enabled !== undefined, {
      message: 'give a name, an enabled flag, or both',
    }),
};

// ── Fancy controls ─────────────────────────────────────────────────────

const listFancyControls = {
  query: paging.extend({
    eventId: providerId.optional(),
    hiddenOnly: z.coerce.boolean().optional(),
  }),
};

const eventParam = { params: z.object({ eventId: providerId }) };
const marketParam = { params: z.object({ marketId: providerId }) };

const setFancyStatus = {
  body: z
    .object({
      eventId: providerId,
      eventName: name.optional(),
      marketId: providerId,
      marketName: name.optional(),
      // A real boolean. `{"showFancy":"false"}` would otherwise open a market
      // somebody meant to close — the wrong direction to fail in.
      showFancy: z.boolean(),
    })
    .strict(),
};

const bulkSetFancyStatus = {
  body: z
    .object({
      eventId: providerId,
      eventName: name.optional(),
      markets: z
        .array(
          z
            .object({
              marketId: providerId,
              marketName: name.optional(),
              showFancy: z.boolean(),
            })
            .strict()
        )
        .min(1)
        // Bounded: this becomes one INSERT ... ON CONFLICT, and an unbounded
        // array is an unbounded statement.
        .max(500),
    })
    .strict(),
};

module.exports = {
  listSports, sportParam, addSport, updateSport,
  listFancyControls, eventParam, marketParam, setFancyStatus, bulkSetFancyStatus,
};

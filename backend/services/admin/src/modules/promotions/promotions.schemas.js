'use strict';

const { z } = require('@ibitplay/common');

/** Parse JSON from multipart string or accept already-parsed value. */
function jsonField(schema, { defaultValue = undefined } = {}) {
  const inner = schema;
  return z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return defaultValue;
    if (typeof val === 'string') {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  }, inner);
}

const gameCard = z
  .object({
    href: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(200),
    img: z.string().trim().max(512).default(''), // empty: the player site draws its own art for the /game/<slug>
    color: z.string().trim().max(80).optional(),
    indicator: z.string().trim().max(40).optional(),
  })
  .strict();

const sportEvent = z
  .object({
    label: z.string().trim().min(1).max(300),
    href: z.string().trim().min(1).max(512),
    icon: z.string().trim().max(512).optional(),
    sportAlt: z.string().trim().max(80).optional(),
  })
  .strict();

const leaderboardRow = z
  .object({
    rank: z.number().int().positive().optional(),
    user: z
      .object({
        name: z.string().trim().max(120).optional(),
        vip: z.string().trim().max(40).optional(),
      })
      .nullable()
      .optional(),
    score: z.union([z.string(), z.number()]),
    prize: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const leaderboard = z
  .object({
    kind: z.enum(['multiplier', 'time', 'payout', 'wager']).default('multiplier'),
    columns: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
    widths: z.array(z.string().trim().max(20)).optional(),
    pages: z.coerce.number().int().min(1).max(500).default(1),
    rows: z.array(leaderboardRow).max(500).default([]),
    live: z
      .object({
        source: z.enum(['wager_leaderboard']).default('wager_leaderboard'),
        period: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .strict()
      .optional(),
  })
  .strict();

const tournamentPanel = z
  .object({
    ends: z.string().trim().max(120).optional(),
    endsAt: z.string().trim().max(64).optional(),
    prizePool: z.string().trim().max(80).optional(),
    prizeSplit: z.string().trim().max(40).optional(),
  })
  .strict();

const qualifyingGames = jsonField(z.array(gameCard).max(80), { defaultValue: [] });
const sportEvents = jsonField(z.array(sportEvent).max(80), { defaultValue: [] });
const tags = jsonField(z.array(z.string().trim().min(1).max(64)).max(30), { defaultValue: [] });
const leaderboardField = jsonField(leaderboard.nullable(), { defaultValue: null });
const tournamentPanelField = jsonField(tournamentPanel.nullable(), { defaultValue: null });
const viewAllHref = z.string().trim().max(512).optional().nullable();

module.exports = {
  gameCard,
  sportEvent,
  leaderboard,
  tournamentPanel,
  qualifyingGames,
  sportEvents,
  tags,
  leaderboardField,
  tournamentPanelField,
  viewAllHref,
};

'use strict';

const { z } = require('@ibitplay/common');

const create = {
  body: z
    .object({
      game: z.string().trim().min(1).max(64),
      gameName: z.string().trim().max(120).optional(),
      imageUrl: z.string().trim().url().max(500).optional(),
      minMultiplier: z.coerce.number().min(1.01).max(10_000_000),
      minBetUsd: z.coerce.number().min(0).max(1_000_000),
      prizeUsd: z.coerce.number().positive().max(10_000_000),
      winners: z.coerce.number().int().min(1).max(1000).default(1),
      startsAt: z.coerce.date().optional(),
      endsAt: z.coerce.date(),
    })
    .strict(),
};

const idParam = { params: z.object({ id: z.coerce.number().int().positive() }) };

module.exports = { create, idParam };

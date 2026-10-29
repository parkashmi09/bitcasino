'use strict';

const { z } = require('@ibitplay/common');

const drawParam = { params: z.object({ number: z.coerce.number().int().positive() }) };

const updateConfig = {
  body: z
    .object({
      enabled: z.boolean().optional(),
      prizePoolUsd: z.coerce.number().min(0).max(100_000_000).optional(),
      winners: z.coerce.number().int().min(1).max(1000).optional(),
      wagerPerTicketUsd: z.coerce.number().positive().max(10_000_000).optional(),
    })
    .strict(),
};

const listDraws = {
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict(),
};

module.exports = { drawParam, updateConfig, listDraws };

'use strict';

const { z } = require('@ibitplay/common');
const { STATUSES, SOURCES } = require('./playerBonus.constants');

const date = z.string().trim().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'must be a date');
const id = z.string().trim().regex(/^\d+$/, 'must be numeric');

const report = {
  query: z
    .object({
      userId: id.optional(),
      status: z.enum(STATUSES).optional(),
      source: z.enum(SOURCES).optional(),
      from: date.optional(),
      to: date.optional(),
      // Direct Users | Agent Users — na ho to sab (purana jawab).
      channel: z.enum(['direct', 'agent']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict(),
};

const userParam = { params: z.object({ userId: id }).strict() };

const forfeit = {
  params: z.object({ id }).strict(),
  body: z.object({ reason: z.string().trim().min(1).max(50).optional() }).strict(),
};

module.exports = { report, userParam, forfeit };

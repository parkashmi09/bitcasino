'use strict';

const { z } = require('@ibitplay/common');
const { PROGRAM } = require('./reload.constants');

const program = z.enum(Object.values(PROGRAM));

const claim = { params: z.object({ program }) };

const updateProgram = {
  params: z.object({ program }),
  body: z
    .object({
      enabled: z.boolean().optional(),
      percent: z.coerce.number().min(0).max(100).optional(),
      minVipLevel: z.coerce.number().int().min(0).max(1000).optional(),
    })
    .strict(),
};

const listClaims = { query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).strict() };

module.exports = { claim, updateProgram, listClaims };

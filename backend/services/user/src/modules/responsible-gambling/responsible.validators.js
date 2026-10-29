'use strict';

const { z } = require('@ibitplay/common');
const { EXCLUSION_TYPE, LIMIT_TYPE, PERIOD_UNIT, BREAK_PERIODS } = require('./responsible.constants');

const exclusionType = z.enum(Object.values(EXCLUSION_TYPE));

const cooldown = {
  body: z.object({ type: exclusionType }).strict(),
};

const selfExclusion = {
  body: z.object({ type: exclusionType, breakPeriod: z.enum(Object.keys(BREAK_PERIODS)) }).strict(),
};

const createLimit = {
  body: z
    .object({
      type: z.enum(Object.values(LIMIT_TYPE)),
      usdAmount: z.coerce.number().positive('the limit must be above zero').max(10_000_000),
      periodUnit: z.enum(Object.values(PERIOD_UNIT)),
    })
    .strict(),
};

const limitParam = {
  params: z.object({ id: z.string().trim().regex(/^\d+$/, 'id must be numeric') }),
};

const userParam = {
  params: z.object({ userId: z.coerce.number().int().positive() }),
};

module.exports = { cooldown, selfExclusion, createLimit, limitParam, userParam };

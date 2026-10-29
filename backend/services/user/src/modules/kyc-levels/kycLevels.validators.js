'use strict';

const { z } = require('@ibitplay/common');

const level = z.coerce.number().int().refine((n) => n === 3 || n === 4, 'level must be 3 or 4');

const levelParam = { params: z.object({ level }) };

const idParam = { params: z.object({ id: z.coerce.number().int().positive() }) };

const review = {
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z
    .object({ status: z.enum(['Verified', 'Rejected']), rejectionReason: z.string().trim().max(500).optional() })
    .strict(),
};

const list = {
  query: z
    .object({
      status: z.enum(['Pending', 'Verified', 'Rejected']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
    .strict(),
};

module.exports = { levelParam, idParam, review, list };

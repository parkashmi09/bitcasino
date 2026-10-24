'use strict';

const { z } = require('@ibitplay/common');

const byVendor = {
  query: z
    .object({
      vendor: z.string().trim().min(1).max(120),
      page: z.coerce.number().int().min(1).default(1),
      per_page: z.coerce.number().int().min(1).max(100).default(20),
    })
    .strict(),
};

const vendors = {
  query: z
    .object({
      vendor: z.string().trim().max(120).optional(),
      // A page size of zero would make `Math.ceil(n / 0)` report Infinity pages.
      pageSize: z.coerce.number().int().min(1).max(500).optional(),
    })
    .strict(),
};

const search = {
  query: z
    .object({
      keyword: z.string().trim().max(120).default(''),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .strict(),
};

module.exports = { byVendor, vendors, search };

'use strict';

const { z } = require('@ibitplay/common');

const id = z.coerce.number().int().positive();
const providerId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/);

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

/** No `userId`. Legacy read it from the URL on an unauthenticated route. */
const mine = { query: paging };

const listMarkets = {
  query: paging.extend({
    // Legacy built `ILIKE '%' || $1 || '%'` across four columns including two
    // CASTs. Bounded here so a search term cannot be a scan of the whole table
    // through four expressions at once.
    search: z.string().trim().min(1).max(80).optional(),
    userId: id.optional(),
    matchId: providerId.optional(),
  }),
};

const userParam = { params: z.object({ userId: id }), query: paging };

module.exports = { mine, listMarkets, userParam };

'use strict';

const { z } = require('@ibitplay/common');

/** `GET /user/profile/:userId/medals` — a player id is a bigint on the wire. No query. */
const publicMedals = {
  params: z.object({ userId: z.string().trim().regex(/^\d{1,19}$/, 'userId must be numeric') }).strict(),
  query: z.object({}).strict(),
};

module.exports = { publicMedals };

'use strict';

const { z } = require('@ibitplay/common');
const { PROVIDERS } = require('./providers');

const provider = z.enum(Object.keys(PROVIDERS));

/**
 * A callback body is NOT strictly validated.
 *
 * Providers add fields without notice, and a `.strict()` schema would reject a
 * genuine, correctly-signed callback the day they do — losing a real deposit.
 * The signature covers the whole body, so anything unexpected in it is
 * authenticated even if we do not recognise it. The adapter picks out what it
 * needs.
 */
const callback = {
  params: z.object({ provider }),
  body: z.record(z.any()),
};

const statusLookup = {
  params: z.object({
    provider,
    reference: z.string().trim().min(1).max(255),
  }),
};

module.exports = { callback, statusLookup, provider };

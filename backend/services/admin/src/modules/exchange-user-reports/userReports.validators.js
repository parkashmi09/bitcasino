'use strict';

const { z } = require('@ibitplay/common');

/** GET /home — koi query nahi. */
const home = { query: z.object({}).strict() };

module.exports = { home };

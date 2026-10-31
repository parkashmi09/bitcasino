#!/usr/bin/env node
'use strict';

/**
 * Clear staff sign-in rate-limit counters (Redis) and explain in-process locks.
 *
 *   node scripts/clear-staff-login-rate-limits.js
 *
 * The per-account lock (8 failures / 15 min) lives in the admin service's
 * memory — restart the admin process (or all of `npm run dev`) after running this.
 */

const path = require('path');
const { loadEnv, coercers, createLogger } = require('@ibitplay/common');

async function main() {
  const logger = createLogger({ name: 'clear-staff-login-limits', pretty: true });
  const config = loadEnv(
    {
      REDIS_URL: coercers.str(''),
      RATE_LIMIT_REDIS_URL: coercers.str(''),
      REDIS_PREFIX: coercers.str('ibitplay'),
      NODE_ENV: coercers.str('development'),
    },
    { serviceDir: path.resolve(__dirname, '..') }
  );

  // Same resolution order as packages/common/src/middleware/rateLimit.js.
  const url = config.RATE_LIMIT_REDIS_URL || config.REDIS_URL;
  if (!url) {
    logger.info(
      'Neither RATE_LIMIT_REDIS_URL nor REDIS_URL is set — HTTP sign-in limits are in the admin process only. Restart admin (or npm run dev) to clear them.'
    );
    return;
  }

  const Redis = require('ioredis');
  const prefix = `${config.REDIS_PREFIX || 'ibitplay'}:rl:`;
  const client = new Redis(url, { keyPrefix: prefix });

  const patterns = ['staff-auth:signin:*', 'staff-auth:2fa:*'];
  let deleted = 0;

  for (const pattern of patterns) {
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) {
        const n = await client.del(...keys);
        deleted += n;
      }
    } while (cursor !== '0');
  }

  await client.quit();
  logger.info(
    { deleted, patterns },
    deleted
      ? 'Cleared staff sign-in rate-limit keys. Restart the admin service to clear in-memory attempt counters.'
      : 'No matching rate-limit keys in Redis. Restart the admin service to clear in-memory attempt counters.'
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

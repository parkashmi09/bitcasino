'use strict';

const { asyncHandler } = require('@ibitplay/common');

const errors = require('./marketing.errors');

/**
 * The gate in front of the marketing panel.
 *
 * A near-literal port of `legacy/system/middleware/marketing.js`, including its
 * reasoning, because that middleware is right:
 *
 *   1. READ-ONLY, STRUCTURALLY. Any verb but GET or HEAD is refused before a
 *      handler runs. The UI also hides the mutations, but this is the
 *      guarantee — a marketing token is incapable of writing through these
 *      routes regardless of what is sent.
 *
 *   2. `kind` IS RE-READ FROM THE DATABASE. A plain staff token, or a classic
 *      executive one, must not reach platform-wide revenue figures by knowing
 *      the URL — so the account type is not taken from a JWT claim.
 *
 *   3. `status` IS RE-ASSERTED even though the staff guard already checked it,
 *      on the grounds that this middleware is the last thing standing between
 *      a revoked account and the numbers.
 *
 * The one change: the DB read is cached for a few seconds. Legacy queried
 * `executives` on every request of every panel page — six requests per screen
 * refresh, each a round trip on the single shared connection.
 */

/** How long an executive lookup may be reused. Short enough that a revoked
 *  account loses access within seconds, long enough to collapse a page load. */
const CACHE_MS = 5_000;

function createProtectMarketing({ models, logger }) {
  const cache = new Map();

  const lookup = async (executiveId) => {
    const cached = cache.get(executiveId);
    if (cached && cached.expires > Date.now()) return cached.row;

    const row = await models.Executives.findOne({
      where: { id: executiveId },
      attributes: ['id', 'username', 'kind', 'status', 'last_login'],
      raw: true,
    });

    cache.set(executiveId, { row, expires: Date.now() + CACHE_MS });
    return row;
  };

  return asyncHandler(async (req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw errors.READ_ONLY({ method: req.method });

    const executiveId = req.staff?.executiveId ?? req.staff?.executive_id;
    if (!executiveId) throw errors.ACCOUNT_REQUIRED();

    const executive = await lookup(executiveId);

    // Same code for "no such executive" and "not a marketing account", so the
    // endpoint does not confirm which executive ids exist.
    if (!executive || executive.kind !== 'marketing') {
      logger?.warn({ executiveId, staffId: req.staff?.id }, 'Non-marketing account refused at the marketing panel');
      throw errors.ACCOUNT_REQUIRED();
    }

    if (executive.status !== 'active') throw errors.ACCOUNT_INACTIVE({ status: executive.status });

    req.marketing = executive;
    return next();
  });
}

module.exports = { createProtectMarketing };

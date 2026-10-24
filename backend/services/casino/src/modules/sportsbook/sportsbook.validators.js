'use strict';

const { z } = require('@ibitplay/common');

const { SUPPORTED_CURRENCIES } = require('../gis/gis.constants');

/**
 * The sportsbook shares the wallet with the casino, so it accepts the same
 * currency set. The provider's own renaming (`USDT` → `USD`) happens in the
 * service, from `PROVIDER_CURRENCY` — not here, because a validator that
 * rewrites its input hides what the client actually sent.
 */
const currency = z.enum(SUPPORTED_CURRENCIES);
const sportsbookUuid = z.string().trim().min(1).max(64);
const sessionId = z.string().trim().uuid();

/**
 * Opening a session.
 *
 * ── WHAT IS MISSING, AND WHY ─────────────────────────────────────────────
 *
 * `player_id`, `player_name` and `email` were all body fields in legacy, on an
 * unauthenticated route. `player_id` is the whole account: one POST opened a
 * real-money sportsbook session against any player id and returned the launch
 * URL for it. All three come from the token here.
 */
const init = {
  body: z
    .object({
      sportsbookUuid,
      currency,
      language: z.string().trim().max(10).optional(),
      returnUrl: z.string().trim().url().max(2048).optional(),
    })
    .strict(),
};

/**
 * Getting back into a session that is already open.
 *
 * Legacy's `refresh-token` took `sportsbook_uuid`, `player_id` and `currency`
 * and called `init` — it opened a NEW session rather than refreshing one,
 * because there was no stored session to refresh. It takes a session id here,
 * and that session must belong to the caller.
 */
const refresh = {
  body: z.object({ sessionId }).strict(),
};

/** Ending a session. Legacy took the provider's token from the body. */
const logout = {
  body: z.object({ sessionId }).strict(),
};

/**
 * `GET /sportsbooks/launch?url=...` HAS NO VALIDATOR BECAUSE IT HAS NO ROUTE.
 *
 * ── THE ONE ENDPOINT THAT IS NOT PORTED ──────────────────────────────────
 *
 * Legacy:
 *
 *     const { url } = req.query;
 *     const response = await axios.get(url, { headers, maxRedirects: 0, ... });
 *     res.json({ success: true, type: 'html', html: response.data });
 *
 * The server fetches any URL the caller names and returns the body. That is a
 * general-purpose request proxy running inside the platform's network:
 *
 *   ?url=http://169.254.169.254/latest/meta-data/iam/...   cloud credentials
 *   ?url=http://127.0.0.1:5432/                            anything bound local
 *   ?url=http://internal-admin/...                         anything reachable
 *
 * and it forwards the caller's IP in `X-Client-Ip`, so the target's own logs
 * blame them rather than us.
 *
 * There is no fix that keeps the endpoint, because its purpose IS to fetch an
 * arbitrary URL. What it was FOR is different: the client needs to open the
 * launch URL the provider returned. That URL comes back from `init` and the
 * client can navigate to it directly — it does not need the server to fetch it
 * on their behalf. So the capability is gone and the use case is covered.
 *
 * A URL allow-list against the provider's host was considered and rejected: it
 * turns a closed door into a door with a lock whose key is "does the hostname
 * end in the right string", and that check has been bypassed enough times that
 * shipping it would be a decision to be breached later.
 */

module.exports = { init, refresh, logout };

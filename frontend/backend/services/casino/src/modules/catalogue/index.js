'use strict';

/**
 * The casino catalogue — what games exist, and launching one.
 *
 * Eleven read routes over two upstream aggregators and one local table.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. EVERY UPSTREAM CREDENTIAL IS IN THE SOURCE
 *
 *     const response = await axios.post('https://api.nexusggreu.com', {
 *       method: "game_list",
 *       agent_code: "Skyla_USD",
 *       agent_token: "83eb5e7c8f7a1852f61692442a5ead9c",
 *       provider_code: providerCode
 *     });
 *
 * `agent_token` is the credential for the aggregator account this platform
 * plays through — the same one `/game_launch` uses to open real-money
 * sessions. It is committed, in three places. On the rotation list.
 *
 * ── 2. THE CATALOGUE WAS FETCHED UPSTREAM ON EVERY REQUEST ───────────────
 *
 * `fetchGameList()` calls the provider and is invoked by `/vendors`,
 * `/games/list` and `/games/lists` — all unauthenticated, all public-facing.
 * There is no cache. A game catalogue is thousands of entries and changes
 * daily at most, and the platform re-fetched the whole thing for every visitor
 * loading the lobby. Anyone could also use those routes to make this server
 * hammer the provider on their behalf; the provider rate-limits US, not them.
 *
 * ── 3. THE UPSTREAM'S ERRORS WERE FORWARDED VERBATIM ─────────────────────
 *
 *     res.status(error.response.status).json({ error: error.response.data });
 *
 * Whatever the aggregator says, including its internal error text and its own
 * status codes, went straight to the caller. Aggregator errors quote request
 * parameters back, and the request parameters include the agent token.
 *
 * ── 4. `/game_launch` OPENED A SESSION FOR ANY ACCOUNT ───────────────────
 *
 *     const { user_code, provider_code, game_code } = req.body;
 *
 * No authentication, account from the body. The same shape as
 * `/api/casino/gamerun`, against a different aggregator.
 *
 * ── 5. AND `/api/games/list` READ THE WHOLE TABLE TO FILTER IN JS ────────
 *
 *     const result = await pg.query('SELECT * FROM apigames');
 *     const filteredGames = games.filter(game => …type… && …vendor…);
 *
 * Every row, every request, filtered and grouped in the process. The database
 * can do both, and does here.
 */
module.exports = {
  name: 'catalogue',
  service: 'casino',
  basePath: '/catalogue',
  models: ['casino', 'core', 'extended'],
  routers: {
    /** Browsing the lobby happens before anybody logs in. */
    public: require('./routes/public.routes'),
    /** Launching a game does not — the player comes from their token. */
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};

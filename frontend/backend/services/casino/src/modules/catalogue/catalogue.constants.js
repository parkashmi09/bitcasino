'use strict';

/**
 * How long an upstream answer may be reused.
 *
 * Legacy cached nothing: `fetchGameList()` called the provider on every
 * request, from three unauthenticated public routes. A game catalogue changes
 * daily at most and runs to thousands of entries — so the platform re-fetched
 * all of it for every visitor loading the lobby, and anyone could use those
 * routes to make this server hammer the provider on their behalf.
 */
const UPSTREAM_CACHE_MS = Object.freeze({
  /** The catalogue itself. */
  gameList: 10 * 60 * 1000,
  /** Jackpot figures move constantly — short, but not zero. */
  jackpots: 15 * 1000,
});

/**
 * The vendors the "lists" endpoint groups under.
 *
 * Legacy held this as a bare array literal called `targetVendors` in the
 * middle of `index.js`, between two route handlers.
 */
const FEATURED_VENDORS = Object.freeze(['EVOLUTION', 'PRAGMATIC', 'EZUGI', 'PLAYTECH']);

/** Matching legacy's `req.query.s || "EVOLUTION"`. */
const DEFAULT_PROVIDER = 'EVOLUTION';

/** Legacy read the whole `apigames` table and filtered in JavaScript. */
const MAX_PAGE_SIZE = 200;

module.exports = { UPSTREAM_CACHE_MS, FEATURED_VENDORS, DEFAULT_PROVIDER, MAX_PAGE_SIZE };

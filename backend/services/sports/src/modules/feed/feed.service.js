'use strict';

const { Op } = require('sequelize');

const errors = require('./feed.errors');
const { SPORT_NAMES, DATE_RANGES, FEED_TIMEZONE } = require('./feed.constants');

/**
 * Everything read from the upstream odds provider.
 *
 * Nine legacy controllers, each with its own copy of the base url, the key, the
 * error handling and (in five of them) its own fetch of the same fixture list.
 * They are one class over one client here, which is what makes the caching,
 * the timeout and the enabled-game filter apply uniformly instead of wherever
 * somebody remembered them.
 *
 * ── TWO FILTERS SIT BETWEEN THE PROVIDER AND A PLAYER ────────────────────
 *
 * `sports_config.enabled` decides which SPORTS appear at all.
 * `admin_fancy_control.show_fancy` decides which FANCY MARKETS appear.
 *
 * The first worked. The second never has: `admin_fancy_control` was not in the
 * schema and no migration created it, so the five endpoints that maintain it
 * returned "relation does not exist" and the filter had nothing to read. Every
 * fancy market the provider sends has been visible and bettable, including the
 * ones an operator tried to close. Migration 024 creates the table and
 * `#hiddenMarkets` below is where it finally does something.
 */
class FeedService {
  constructor({ models, feed, live, media, results, cache, logger, config }) {
    this.models = models;
    this.feed = feed;
    /**
     * Results live on their own host and take no key — see
     * `RESULTS_API_BASE` in the legacy settlement cron. Without it nothing
     * settles, so the refusal below names it rather than returning empty.
     */
    this.results = results ?? null;
    /**
     * The shared cache the two feed jobs write.
     *
     * `legacy/sportsmain/API/service.js` reads it and NEVER calls the provider:
     * `alleventsData:<sid>` for the board, `oddsData:<gmid>` for a match's
     * book. The reads below do the same, and fall through to a live fetch when
     * the cache is cold — so a deployment without the worker still serves,
     * just without the pre-warming.
     */
    this.cache = cache ?? null;
    // The two secondary providers. Optional — a deployment that has not wired
    // them gets a clear refusal from the three endpoints that need them rather
    // than a crash at boot.
    this.live = live ?? null;
    this.media = media ?? null;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  In-play
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /sports/inplay
   *
   * Live matches, filtered to the sports this operator has switched on.
   *
   * Legacy took an optional `gameId` from the request BODY on a POST, which is
   * why this one route is a POST and the other thirty are GETs. It is a read;
   * `gameId` is a query parameter here and the route is a GET.
   */
  async inplay({ gameId } = {}) {
    const data = await this.feed.get('/inplay');
    const games = this.#asArray(data);

    if (gameId != null) {
      const match = games.find((g) => String(g?.id) === String(gameId));
      if (!match) throw errors.GAME_NOT_FOUND({ gameId });
      return match;
    }

    return this.#onlyEnabled(games);
  }

  /** @legacy GET /sports/allinplay */
  async allInplay() {
    return this.#onlyEnabled(this.#asArray(await this.feed.get('/inplay')));
  }

  /**
   * @legacy GET /sports/inplayGameId/:gameId
   *
   * One sport's live matches.
   *
   * This route bypassed the queue and called the controller directly, unlike
   * its neighbours — so the "everything is queued" invariant the file claims
   * was not true of four of its routes.
   */
  async inplayByGame({ gameId }) {
    const games = this.#asArray(await this.feed.get('/inplay'));
    const match = games.filter((g) => String(g?.id) === String(gameId));
    if (!match.length) throw errors.GAME_NOT_FOUND({ gameId });
    return this.#onlyEnabled(match);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Fixtures
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /sports/all-matches
   *
   * The whole board. Five legacy endpoints each fetched this list fresh from
   * the provider on every request; it is fetched once and cached for a few
   * seconds — long enough to collapse one page load, short enough that a
   * fixture change is visible almost immediately.
   */
  async allMatches() {
    return this.#onlyEnabled(this.#asArray(await this.feed.get('/home')));
  }

  /** @legacy GET /sports/matches/:gameId */
  async matchesByGame({ gameId }) {
    const games = this.#asArray(await this.feed.get('/home'));
    const match = games.filter((g) => String(g?.id) === String(gameId));
    if (!match.length) throw errors.GAME_NOT_FOUND({ gameId });
    return this.#onlyEnabled(match);
  }

  /** @legacy GET /sports/matches-by-date/:dateType */
  async matchesByDate({ dateType }) {
    const range = this.#rangeFor(dateType);
    const games = this.#onlyEnabled(this.#asArray(await this.feed.get('/home')));
    return this.#withinRange(games, range);
  }

  /**
   * @legacy GET /sports/matches/:dateType/:gameId
   *
   * Legacy fetched `/home` TWICE inside this one handler — once for the
   * fixture list and once again a few lines later. Two upstream round trips
   * per request for the same bytes.
   */
  async matchesByDateAndGame({ dateType, gameId }) {
    const range = this.#rangeFor(dateType);
    const games = this.#asArray(await this.feed.get('/home'));
    const forGame = games.filter((g) => String(g?.id) === String(gameId));
    if (!forGame.length) throw errors.GAME_NOT_FOUND({ gameId });
    return this.#withinRange(await this.#onlyEnabled(forGame), range);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Series, events and sports
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /sports/getSeries */
  async series({ sportId }) {
    return this.feed.get('/getCompetitions', { sportid: sportId });
  }

  /** @legacy GET /sports/getMatchesBySportsID */
  async eventsBySport({ sportId }) {
    return this.feed.get('/getEventsBySportsID', { sportid: sportId });
  }

  /** @legacy GET /sports/getMatchesBySportsIDSeriesID */
  async eventsBySeries({ sportId, seriesId }) {
    return this.feed.get('/getEvents', { sportid: sportId, seriesid: seriesId });
  }

  /** @legacy GET /sports/allSportsID */
  async allSportIds() {
    const data = await this.feed.get('/allSportsID');
    const rows = this.#asArray(data);

    // The provider sends ids; the display names were a literal in the legacy
    // controller. Named here so the two cannot drift.
    return rows.map((row) => ({
      ...row,
      name: row?.name ?? SPORT_NAMES[String(row?.id)] ?? null,
    }));
  }

  /** @legacy GET /sports/eventList */
  async eventList({ seriesId }) {
    return this.feed.get('/result/event-list', { sid: seriesId });
  }

  /** @legacy GET /sports/event-details */
  async eventDetails({ eventId }) {
    return this.#viaResults('/get_result', { gmid: eventId });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Markets and prices
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /sports/market-ids-v1 */
  async marketIdsV1({ eventId }) {
    return this.feed.get('/GetMarketIdsV1', { eventid: eventId });
  }

  /** @legacy GET /sports/market-ids-v2 */
  async marketIdsV2({ marketId }) {
    return this.feed.get('/GetMarketIdsV2', { market_id: marketId });
  }

  /** @legacy GET /sports/market-odds */
  async marketOdds({ marketId }) {
    return this.feed.get('/GetMarketOdds', { market_id: marketId });
  }

  /** @legacy GET /sports/lineMarket */
  async lineMarket({ eventId }) {
    return this.feed.get('/GetLineMarket', { eventid: eventId });
  }

  /** @legacy GET /sports/marketDetails */
  async marketDetails({ marketId }) {
    return this.feed.get('/GetMarketDetails', { market_id: marketId });
  }

  /**
   * @legacy GET /sports/bookmakerFancy
   *
   * Fancy sessions for an event, with the markets an operator has closed
   * removed.
   *
   *   THIS FILTER HAS NEVER RUN. `admin_fancy_control` did not exist, so the
   *   five endpoints that write it errored and there was nothing to filter
   *   against — every fancy market the provider returned reached the player,
   *   including markets somebody had explicitly tried to close.
   */
  async bookmakerFancy({ eventId }) {
    const data = await this.feed.get('/GetSession', { eventid: eventId });
    const hidden = await this.#hiddenMarkets(eventId);
    if (!hidden.size) return data;

    return this.#filterMarkets(data, (market) => !hidden.has(String(market?.marketId ?? market?.mid ?? '')));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Results
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /sports/event-result
   * @legacy GET /event-result
   *
   * Declared twice: once under `/sports` and once at the root, both calling the
   * same controller. The root pair (`resultroutes.js`) was mounted separately
   * and neither had the sports-enabled check the `/sports` ones did.
   */
  async eventResult({ eventId, sportId }) {
    return this.#viaResults('/get_result', { sid: sportId, gmid: eventId });
  }

  /**
   * @legacy GET /sports/event-list-result
   * @legacy GET /event-list-result
   */
  async eventListResult({ seriesId }) {
    return this.feed.get('/result/event-list', { sid: seriesId });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The second provider — fixtures, results, stream and scorecard
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/sportsmain/get-all-sports-data
   *
   * The second provider's fixture list for one sport.
   *
   * Legacy read it from `http://159.198.77.241:8100` — a second bare IP over
   * cleartext, hardcoded in `sportsmain/API/controller.js` alongside the first
   * one. It also did `JSON.parse(data)` on a value the service layer had
   * already parsed, so a well-formed response threw and the endpoint answered
   * 500; only responses that happened to arrive as strings worked.
   */
  async liveSportsData({ sportId }) {
    /**
     * Cache first — this is the read `getAllSportsData` performs.
     *
     * The `feed:events` job writes `alleventsData:<sportId>` every 60s. Falling
     * through to the provider on a miss is a deliberate difference from legacy,
     * which returned a 400 for a cold key: an empty board because the worker
     * has not started yet is indistinguishable, to a player, from an outage.
     */
    const cached = await this.#cached(`alleventsData:${sportId}`);
    if (cached) {
      return {
        t1: Array.isArray(cached.t1) ? cached.t1 : [],
        t2: Array.isArray(cached.t2) ? cached.t2 : [],
      };
    }

    const data = await this.#viaLive('/getdata', { sid: sportId });
    // The provider returns `{t1, t2}` — two lists. Legacy defaulted them to
    // empty arrays and returned the shape unconditionally, which is right.
    return { t1: Array.isArray(data?.t1) ? data.t1 : [], t2: Array.isArray(data?.t2) ? data.t2 : [] };
  }

  /**
   * @legacy POST /api/sportsmain/get-sports-data-id
   *
   * One match's full book — MATCH_ODDS, Bookmaker, fancy, oddeven, meter and
   * the in-match casino markets.
   *
   * Cache first: `feed:odds` refreshes `oddsData:<gmid>` every two seconds, and
   * that cadence is the only reason this is servable at all. A live fetch per
   * request would be one upstream call per player watching a match.
   */
  async liveSportsDataById({ sportId, matchId }) {
    const cached = await this.#cached(`oddsData:${matchId}`);
    if (cached) return cached;

    return this.#viaLive('/getdata', { sid: sportId, gmid: matchId });
  }

  /**
   * @legacy POST /api/sportsmain/get-result
   *
   * The settled markets for one match — what settlement reads.
   *
   * Answers `{count, etid, gmid, markets:[{gtype, marketName, status,
   * winnerId, ...}]}`. `status: 'SETTLE'` and `winnerId` are the two fields
   * that decide a payout.
   */
  async liveResult({ sportId, eventId }) {
    if (!this.results) throw errors.PROVIDER_NOT_CONFIGURED({ provider: 'results' });
    return this.results.get('/get_result', { sid: sportId, gmid: eventId });
  }

  /**
   * @legacy POST /api/sportsmain/get-live-stream
   *
   * The video stream for a match.
   *
   *   THE URL LEGACY USED WAS A DEMO ENDPOINT:
   *   `https://diamond-sports-api-demo-s2.avrkhub.in/sports_stream`, with
   *   `-demo-` in the hostname, serving production traffic. The key went in the
   *   QUERY STRING, which puts it in every access log along the way.
   */
  async liveStream({ sportId, matchId }) {
    return this.#viaMedia('/sports_stream', { id: matchId, etid: sportId });
  }

  /** @legacy POST /api/sportsmain/get-scorecard */
  async scorecard({ sportId, matchId }) {
    return this.#viaMedia('/scorecard', { etid: sportId, gmid: matchId });
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Read and parse one cache key.
   *
   * Returns `null` for a miss, a parse failure, or no cache at all — every one
   * of which means the same thing to the caller: go and fetch it. A malformed
   * cached value must never surface as an error, or one bad write by the worker
   * would break the board until its TTL expired.
   */
  async #cached(key) {
    if (!this.cache) return null;
    try {
      const raw = await this.cache.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      this.logger?.debug({ key, err: error.message }, 'Ignoring an unreadable cache entry');
      return null;
    }
  }

  #viaResults(path, query) {
    if (!this.results) throw errors.PROVIDER_NOT_CONFIGURED({ provider: 'results' });
    return this.results.get(path, query);
  }

  #viaLive(path, query) {
    if (!this.live) throw errors.PROVIDER_NOT_CONFIGURED({ provider: 'live' });
    return this.live.get(path, query);
  }

  #viaMedia(path, query) {
    if (!this.media) throw errors.PROVIDER_NOT_CONFIGURED({ provider: 'media' });
    return this.media.get(path, query);
  }

  /**
   * The market ids an operator has closed for an event.
   *
   * Empty when nothing is closed, which is the common case — and the caller
   * skips the filtering pass entirely on an empty set rather than walking a
   * large response for nothing.
   */
  async #hiddenMarkets(eventId) {
    const rows = await this.models.AdminFancyControl.findAll({
      where: { event_id: String(eventId), show_fancy: false },
      attributes: ['market_id'],
      raw: true,
    });
    return new Set(rows.map((r) => String(r.market_id)));
  }

  /**
   * Which sports appear at all.
   *
   * `sports_config.game_id` is compared as TEXT because the provider sends ids
   * as strings and the column is not consistently one type across deployments —
   * the legacy filter did `.toString()` on both sides for the same reason.
   */
  async #onlyEnabled(games) {
    if (!games.length) return games;

    const enabled = await this.models.SportsConfig.findAll({
      where: { enabled: true },
      attributes: ['game_id'],
      raw: true,
    });
    const allowed = new Set(enabled.map((r) => String(r.game_id)));

    return games.filter((g) => allowed.has(String(g?.id)));
  }

  /**
   * `today` / `tomorrow`, in the operator's timezone.
   *
   * Legacy used `moment().utcOffset(330)` — the IST offset as a literal, in a
   * file that also read `process.env.APP_TZ` and then ignored it. A fixed
   * offset is also wrong anywhere that observes daylight saving, which several
   * of the sports on the board do.
   */
  #rangeFor(dateType) {
    const spec = DATE_RANGES[dateType];
    if (!spec) throw errors.INVALID_DATE_RANGE({ dateType, allowed: Object.keys(DATE_RANGES) });

    const zone = this.config?.SPORTS_FEED_TIMEZONE || FEED_TIMEZONE;
    const now = new Date();

    // Midnight in `zone`, expressed as an instant.
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const at = (type) => parts.find((p) => p.type === type)?.value;
    const midnight = new Date(`${at('year')}-${at('month')}-${at('day')}T00:00:00`);

    const start = new Date(midnight.getTime() + spec.offsetDays * 86_400_000);
    const end = new Date(start.getTime() + spec.spanDays * 86_400_000);
    return { start, end };
  }

  /**
   * Keep games with a market starting inside the range.
   *
   * A game's own start time is not in the feed — only its markets carry one —
   * so the earliest market start stands in for it, which is what legacy did.
   */
  #withinRange(games, { start, end }) {
    return games.filter((game) => {
      const earliest = this.#earliestMarketStart(game);
      return earliest && earliest >= start && earliest < end;
    });
  }

  #earliestMarketStart(game) {
    const markets = Array.isArray(game?.markets) ? game.markets : [];
    let min = null;
    for (const market of markets) {
      const raw = market?.marketStartTime;
      if (!raw) continue;
      const when = new Date(raw);
      if (Number.isNaN(when.getTime())) continue;
      if (!min || when < min) min = when;
    }
    return min;
  }

  /**
   * Walk a feed response and drop markets the predicate rejects.
   *
   * The provider's fancy payload nests markets under a few different keys
   * depending on the endpoint, so this looks for the shapes actually seen
   * rather than assuming one. Anything it does not recognise passes through
   * untouched — a filter that silently emptied a response would be worse than
   * one that occasionally shows a market it should not.
   */
  #filterMarkets(data, keep) {
    if (Array.isArray(data)) return data.filter(keep);
    if (!data || typeof data !== 'object') return data;

    const out = { ...data };
    for (const key of ['data', 'markets', 'sessions', 'result']) {
      if (Array.isArray(out[key])) out[key] = out[key].filter(keep);
    }
    return out;
  }

  /** The provider answers sometimes with an array, sometimes with `{data:[...]}`. */
  #asArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }
}

module.exports = { FeedService };

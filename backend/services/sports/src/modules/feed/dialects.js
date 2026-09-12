'use strict';

/**
 * Provider dialects — how one logical feed call becomes one provider's request.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * `FeedService` asks for twenty-odd logical paths — `/home`, `/inplay`,
 * `/allSportsID`, `/GetMarketOdds`, `/result/event-result` and so on. Those
 * names are ScoreSwift's, because that is what the port was first written
 * against, and `FeedClient` passed them to the provider verbatim.
 *
 * Verbatim only works while every provider speaks the same dialect, and they do
 * not. The diamond feed this platform actually runs on exposes ONE endpoint —
 * `/highlighthomePrivate?key=&etid=` — returning a sport's whole board with the
 * market prices inline. Asking it for `/allSportsID` gets a 404, which is
 * exactly the 502 the sports screens were showing.
 *
 * A dialect translates one logical call into one of four outcomes:
 *
 *   { path, query }   a single upstream request
 *   { fanOut: [...] } several, concatenated (this provider is keyed on sport)
 *   { local }         answered without the network
 *   { unsupported }   the provider cannot serve this at all
 *
 * ── AND IT SAYS WHAT IT CANNOT DO ────────────────────────────────────────
 *
 * `unsupported` is the important part. A dialect that silently returned `[]`
 * for results or fancy markets would look like "no data today" — forever, and
 * indistinguishably from a quiet day. That is the failure mode this port keeps
 * finding. An unsupported call raises a named 501 carrying the provider and the
 * capability, so the gap shows up in a log line instead of as an empty screen.
 * ═════════════════════════════════════════════════════════════════════════
 */

const { SPORT_NAMES } = require('./feed.constants');

/** Every sport the platform has a name for, as this provider's `etid`. */
const KNOWN_SPORT_IDS = Object.freeze(Object.keys(SPORT_NAMES).map(Number));

/**
 * Which sports to actually ASK the provider about.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS IS A COST CONTROL, NOT A VISIBILITY ONE
 *
 * The provider is keyed on `etid`, so an unscoped call like `/home` becomes one
 * upstream request PER SPORT. Fanning out over all nineteen names the platform
 * knows meant nineteen requests for a board that only trades three — and the
 * provider rate-limits.
 *
 * `SPORTS_ACTIVE_EIDS` bounds that. It is deliberately NOT the same question as
 * `sports_config.enabled`, which decides what a PLAYER SEES and is the
 * operator's switch in the admin panel:
 *
 *   SPORTS_ACTIVE_EIDS   what we pay to fetch      (deployment)
 *   sports_config        what we show              (operator, at runtime)
 *
 * Collapsing them would mean an operator enabling a sport in the panel silently
 * did nothing, because nothing was fetched for it. Keeping them apart means the
 * panel toggle works within whatever the deployment fetches, and widening the
 * fetch is a deliberate config change.
 * ═════════════════════════════════════════════════════════════════════════
 */
let activeSportIds = KNOWN_SPORT_IDS;

/** Called once at client construction. */
function setActiveSportIds(ids) {
  const parsed = (Array.isArray(ids) ? ids : String(ids || '').split(','))
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  activeSportIds = parsed.length ? Object.freeze(parsed) : KNOWN_SPORT_IDS;
  return activeSportIds;
}

/** One upstream request per ACTIVE sport — the provider requires `etid`. */
const boardFanOut = () =>
  activeSportIds.map((etid) => ({ path: '/highlighthomePrivate', query: { etid } }));

/**
 * `{data:{data:{t1,t2}}}` → one flat array of board rows.
 *
 * `t1` and `t2` are two tiers of the same thing — the main board and the
 * secondary/virtual one — carrying an identical row shape. They are
 * concatenated; a row keeps its own `iscc` and `cname` if a caller needs to
 * tell them apart.
 */
function boardRows(body) {
  const inner = body?.data?.data ?? body?.data ?? body;
  if (Array.isArray(inner)) return inner;
  const t1 = Array.isArray(inner?.t1) ? inner.t1 : [];
  const t2 = Array.isArray(inner?.t2) ? inner.t2 : [];
  return [...t1, ...t2];
}

/** Paths whose response is a flat object rather than a board. */
const RAW_PATHS = new Set(['/sports_stream', '/scorecard', '/get_result']);

/**
 * The straight passthrough: the provider's paths ARE the service's paths.
 *
 * This is what `FeedClient` did unconditionally, kept as a named dialect so
 * "no translation" reads as a choice rather than an absence of one.
 */
const scoreswift = {
  name: 'scoreswift',
  translate: (path, query) => ({ path, query }),
  shape: (_path, body) => body,
};

/**
 * The diamond feed: one endpoint, keyed on sport.
 *
 *     GET /highlighthomePrivate?key=<key>&etid=<sportId>
 *
 * A row carries the fixture AND its prices:
 *
 *     gmid, etid, ename, cname, stime, iplay, status, tv,
 *     mname ('MATCH_ODDS'), section[{ nat, gstatus, odds[{ oname, odds, size }] }]
 *
 * which is why `/home`, `/inplay` and the market reads all come from the same
 * place. `gmid` is the event id and `mid` the market id, in the platform's
 * vocabulary.
 */
const diamond = {
  name: 'diamond',

  translate(path, query = {}) {
    switch (path) {
      // The whole board, and the live subset of it. Neither is scoped to a
      // sport and the provider demands one, so both fan out.
      case '/home':
      case '/inplay':
        return { fanOut: boardFanOut() };

      // One sport's board.
      case '/getEventsBySportsID':
      case '/getCompetitions':
        return { path: '/highlighthomePrivate', query: { etid: query.sportid } };

      /**
       * The second provider's fixture read — same data, same host.
       *
       * `sportsmain` treated this as a separate provider on a separate bare IP.
       * It is the same feed: with a `gmid` it is one match's header
       * (`gamedetailPrivate`), without one it is that sport's board.
       */
      case '/getdata':
        return query.gmid
          ? { path: '/gamedetailPrivate', query: { etid: query.sid, gmid: query.gmid } }
          : { path: '/highlighthomePrivate', query: { etid: query.sid } };

      /**
       * The video stream and the scorecard.
       *
       * Both are on the SAME host as the odds, with the same key — legacy had
       * them on a third hostname (`…-demo-s2.avrkhub.in`) which also works and
       * resolves to the same service. One provider, not three.
       */
      case '/sports_stream':
        return { path: '/sports_stream', query: { id: query.id, etid: query.etid }, raw: true };

      case '/scorecard':
        return { path: '/scorecard', query: { etid: query.etid, gmid: query.gmid }, raw: true };

      /**
       * The sport list.
       *
       * Derived from the platform's own table rather than fetched: the provider
       * has no endpoint for it, and the ids ARE its `etid` values, so the two
       * agree by construction rather than by a mapping somebody maintains.
       */
      case '/allSportsID':
        return {
          local: () => Object.entries(SPORT_NAMES).map(([id, name]) => ({ etid: Number(id), name })),
        };

      /**
       * EVERY market on one match — this is the real odds endpoint.
       *
       * `gamedataPrivate?gmid=&etid=` returns one row per market:
       *
       *   gtype=match          MATCH_ODDS
       *   gtype=match1         Bookmaker
       *   gtype=fancy          the session/fancy book
       *   gtype=oddeven        odd/even
       *   gtype=meter          meter
       *   gtype=cricketcasino  the in-match casino markets
       *
       * The board (`highlighthomePrivate`) carries only MATCH_ODDS inline, which
       * is why fancy looked unavailable until this endpoint turned up: the board
       * is the fixture LIST, this is the BOOK.
       */
      case '/GetMarketIdsV1':
      case '/GetLineMarket':
      case '/GetSession':
        /**
         * `etid` IS REQUIRED AND THE CALLER USUALLY DOES NOT HAVE IT.
         *
         * `GET /feed/markets/line?eventId=` carries a match id and nothing else
         * — the platform's own routes are keyed on the event, because that is
         * what a bet slip knows. The provider needs the SPORT too, and answers
         * `400 gmid and etid required` without it.
         *
         * So when the sport is absent it is resolved from the board, which
         * carries `etid` on every row. The board is cached, so this is one
         * lookup the first time and free afterwards.
         */
        return query.etid ?? query.sportid
          ? { path: '/gamedataPrivate', query: { gmid: query.eventid, etid: query.etid ?? query.sportid } }
          : {
              resolve: {
                // Find the match on the board…
                fanOut: boardFanOut(),
                find: (row) => String(row.gmid) === String(query.eventid),
                // …then ask for its book, using the sport the row named.
                then: (row) => ({
                  path: '/gamedataPrivate',
                  query: { gmid: query.eventid, etid: row.etid },
                }),
                missing: `No match with gmid=${query.eventid} is on the board`,
              },
            };

      /**
       * A market id with no match to hang it on.
       *
       * `gamedataPrivate` is keyed on the MATCH, and `etid` is required
       * alongside `gmid` — so a bare `market_id` has to find its match first.
       * The board carries `mid` on every row, and it is cached, so this costs
       * one scan and nothing after that.
       */
      case '/GetMarketOdds':
      case '/GetMarketDetails':
      case '/GetMarketIdsV2':
        return { fanOut: boardFanOut(), filter: (row) => String(row.mid) === String(query.market_id) };

      /**
       * Results — settled markets for one match.
       *
       * On a SEPARATE host (`RESULTS_API_BASE` in `sportsmain/cron/
       * settlement.js`), which is why the `results` provider exists as its own
       * entry rather than another path on the odds feed.
       *
       * Answers `{count, etid, gmid, markets: [...]}` where each market carries
       * `gtype` (FANCY / CRICKETCASINO / METER / ODDEVEN), `marketName`,
       * `status` ('SETTLE') and `winnerId` — which is what settlement needs.
       */
      case '/result/event-result':
      case '/get_result':
        return { path: '/get_result', query: { sid: query.sport_id ?? query.sid, gmid: query.eventid ?? query.gmid }, raw: true };

      /**
       * NOT SERVED.
       *
       * `/result/event-list` wants results BY SERIES and this provider is keyed
       * on one match; `/getEvents` wants a series fixture list it has no
       * endpoint for. Saying so beats returning `[]`, which renders as "nothing
       * today" every day and looks like data rather than a gap.
       */
      case '/result/event-list':
      case '/getEvents':
      default:
        return { unsupported: path };
    }
  },

  shape(path, body) {
    // `/sports_stream`, `/scorecard` and `/get_result` answer with a flat
    // object, not a board. Nothing to flatten.
    if (RAW_PATHS.has(path)) return body;

    /**
     * `/getdata` KEEPS THE TWO TIERS SEPARATE.
     *
     * Every other caller wants one list, so `boardRows` concatenates `t1` and
     * `t2`. `liveSportsData` is the exception — it reads `data.t1` and
     * `data.t2` by name and defaults each to `[]`:
     *
     *     return { t1: Array.isArray(data?.t1) ? data.t1 : [], t2: ... }
     *
     * Handed a flat array it found neither key and returned
     * `{t1: [], t2: []}` — a successful-looking 200 with nothing in it, which
     * is exactly the shape of failure this dialect exists to avoid.
     *
     * Branching on the BODY rather than the path, because `/getdata` means two
     * different upstream calls: with a `gmid` it is `gamedetailPrivate`, which
     * answers with a plain array and has no tiers to preserve.
     */
    if (path === '/getdata') {
      const inner = body?.data?.data ?? body?.data ?? body;
      if (inner && !Array.isArray(inner) && (inner.t1 || inner.t2)) {
        return {
          t1: (Array.isArray(inner.t1) ? inner.t1 : []).map(normaliseRow),
          t2: (Array.isArray(inner.t2) ? inner.t2 : []).map(normaliseRow),
        };
      }
      return boardRows(body).map(normaliseRow);
    }

    const rows = boardRows(body).map(normaliseRow);
    // `/inplay` is the board filtered to what is running.
    return path === '/inplay' ? rows.filter((row) => row.iplay === true) : rows;
  },
};

/**
 * Give a diamond row the identity fields the service reads.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `#onlyEnabled` COMPARES `game.id` AGAINST `sports_config.game_id`
 *
 * In ScoreSwift's shape a board row's `id` IS the sport id, so that comparison
 * works. A diamond row has no `id` at all — the sport is `etid` and the match
 * is `gmid` — so `String(undefined)` matched nothing and the filter dropped
 * EVERY row. `/feed/matches` and `/feed/inplay/all` returned `[]` while the
 * per-sport board returned 24 fixtures, which is the confusing pair of results
 * that led here.
 *
 * The alias is added in the DIALECT rather than by loosening the filter,
 * because this is precisely the dialect's job: present the provider's data in
 * the vocabulary the service already speaks. Loosening `#onlyEnabled` to try
 * three field names would push provider-specific knowledge into code that
 * should not have any.
 *
 * The original fields are kept — nothing downstream loses access to `gmid`,
 * and a client that already reads `etid` is unaffected.
 * ═════════════════════════════════════════════════════════════════════════
 */
function normaliseRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    /** The SPORT id — what `sports_config.game_id` holds. */
    id: row.id ?? row.etid,
    /** The MATCH id, under the name the rest of the platform uses. */
    eventId: row.eventId ?? row.gmid,
    marketId: row.marketId ?? row.mid,
  };
}

const DIALECTS = Object.freeze({ scoreswift, diamond });

module.exports = { DIALECTS, KNOWN_SPORT_IDS, setActiveSportIds, boardRows };

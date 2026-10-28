'use strict';

const { QueryTypes } = require('sequelize');

const { manageableStaffIds } = require('../staff-directory/staffDirectory.service');
const { groupByEvent, buildUserBook, sportName } = require('./marketBook');
const { marketLabel, rateText } = require('./betLabels');

/**
 * Exchange market — Market Analysis, Game Details (book, bets) aur Current Bets.
 *
 * Scope: login wale ke tree ke staff (staff_hierarchy) ke players. Owner (canIssueFunds)
 * ko direct users (parent_staff_id NULL) bhi. Zip me ye `getUserIdsByHierarchy` tha.
 */

// zip ka EXCLUDE_HELPER_KEYS — fancy ke bookkeeping rows ({sel}back / lay / totalstake) nahi
const REAL_RUNNERS = `e.team_name NOT ILIKE '%back' AND e.team_name NOT ILIKE '%lay' AND e.team_name NOT ILIKE '%totalstake'`;

// downline ke players — :staffIds aur :withDirect replacements chahiye. Demo user kabhi nahi.
const IN_SCOPE = `(u.parent_staff_id IN (:staffIds) OR (:withDirect AND u.parent_staff_id IS NULL AND NOT u.is_demo))`;

// Direct Users | Agent Users tab → SQL (na bheja = dono, purana jawab).
const CHANNEL_SQL = { direct: 'u.parent_staff_id IS NULL', agent: 'u.parent_staff_id IS NOT NULL' };

// Current Bets ke radio → SQL (zip: Matched / Unmatched / Deleted)
const MATCH_STATUS_SQL = {
  matchbet: `b.result_status = 'pending' AND COALESCE(b.unmatched, false) = false`,
  unsettled: `b.result_status = 'pending' AND b.unmatched = true`,
  deletebet: `b.result_status = 'void'`,
};

// fancy bets 'yes'/'no' me save hoti hain — back = back/yes, lay = lay/no
const BET_TYPE_SQL = {
  all: 'TRUE',
  back: `LOWER(b.bet_type) IN ('back', 'yes')`,
  lay: `LOWER(b.bet_type) IN ('lay', 'no')`,
};

class ExchangeMarketService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  get sequelize() {
    return this.models.Staff.sequelize;
  }

  /** Raw SELECT — chhota helper. */
  #select(sql, replacements) {
    return this.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  }

  /** Login wale ka scope: tree ke staff ids + direct users dikhenge ya nahi. */
  async #scope(actor) {
    const ids = await manageableStaffIds(this.models, actor.id, { logger: this.logger, level: actor.level });
    // IN () khali nahi ho sakta — -1 kisi staff ka id nahi
    const staffIds = ids.length ? ids.map(Number) : [-1];
    return { staffIds, withDirect: Boolean(actor.canIssueFunds) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Market Analysis (zip: /admin/reports/market-analysis[/dashboard])
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Downline ka open book, event wise. `eventId` do to sirf wo event (Game Details) —
   * tab fancy ka value sign nahi palta (zip getMarketAnalysis jaisa).
   */
  async analysis({ actor, eventId }) {
    const scope = await this.#scope(actor);
    const rows = await this.#select(
      `SELECT e.match_id, e.event_id, e.team_name, e.exposure_amount, e.match_title, e.game_type, e.updated_at
         FROM mssports.user_exposures e
         JOIN users u ON u.id = e.user_id
        WHERE ${IN_SCOPE} AND ${REAL_RUNNERS}
          ${eventId ? 'AND e.event_id = :eventId' : ''}
        ORDER BY e.id ASC`,
      { ...scope, eventId: eventId ?? null }
    );

    const meta = await this.#eventMeta([...new Set(rows.map((r) => r.event_id).filter(Boolean))]);
    return { events: groupByEvent(rows, meta, { fancyAsIs: Boolean(eventId) }) };
  }

  /** Har event ka sport id aur start time — bets pe stored hai. */
  async #eventMeta(eventIds) {
    if (!eventIds.length) return new Map();
    const rows = await this.#select(
      `SELECT eventid, MAX(sport_id) AS sport_id, MAX(match_start_time) AS start_time
         FROM mssports."SportsBet"
        WHERE eventid IN (:eventIds)
        GROUP BY eventid`,
      { eventIds }
    );
    return new Map(rows.map((r) => [String(r.eventid), { sportId: r.sport_id ?? null, startTime: r.start_time ?? null }]));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  User Book (zip: /admin/reports/user-book)
  // ══════════════════════════════════════════════════════════════════════

  /** Ek event ke ek market (gameType) ka per-user book, downline tree me. */
  async userBook({ actor, eventId, gameType }) {
    const scope = await this.#scope(actor);
    const exposures = await this.#select(
      `SELECT e.user_id, e.team_name, e.exposure_amount, u.name, u.parent_staff_id
         FROM mssports.user_exposures e
         JOIN users u ON u.id = e.user_id
        WHERE ${IN_SCOPE} AND ${REAL_RUNNERS}
          AND e.event_id = :eventId
          ${gameType ? 'AND e.game_type = :gameType' : ''}
        ORDER BY e.id ASC`,
      { ...scope, eventId, gameType: gameType ?? null }
    );
    if (!exposures.length) return { runners: [], tree: [] };

    const users = [...new Map(exposures.map((e) => [String(e.user_id), { id: e.user_id, name: e.name, parent_staff_id: e.parent_staff_id }])).values()];
    const staffById = await this.#staffChain(users.map((u) => u.parent_staff_id), actor.id);
    return buildUserBook(exposures, users, staffById, actor.id);
  }

  /** Players ke parents se upar viewer tak ke saare staff (id, name, parent_id). */
  async #staffChain(parentIds, viewerId) {
    const staffById = new Map();
    let pending = [...new Set(parentIds.filter((id) => id != null).map(Number))];
    while (pending.length) {
      const rows = await this.#select('SELECT id, name, parent_id FROM staff WHERE id IN (:ids)', { ids: pending });
      rows.forEach((s) => staffById.set(Number(s.id), { id: Number(s.id), name: s.name, parent_id: s.parent_id }));
      pending = [...new Set(rows
        .filter((s) => Number(s.id) !== Number(viewerId) && s.parent_id != null)
        .map((s) => Number(s.parent_id)))]
        .filter((id) => !staffById.has(id));
    }
    return staffById;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Event bets (zip: /admin/reports/match-downline-bets) — My Bets / View More
  // ══════════════════════════════════════════════════════════════════════

  /** Ek event ki downline bets: open (matched/unmatched) + deleted (void). */
  async eventBets({ actor, eventId, limit }) {
    const scope = await this.#scope(actor);
    const rows = await this.#select(
      `SELECT b.*, u.name AS username
         FROM mssports."SportsBet" b
         JOIN users u ON u.id = b.user_id
        WHERE ${IN_SCOPE} AND b.eventid = :eventId
          AND b.result_status IN ('pending', 'void')
        ORDER BY b.created_at DESC
        LIMIT :limit`,
      { ...scope, eventId, limit }
    );
    return { rows: rows.map(shapeBet) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Current Bets (zip: /admin/reports/current-bets)
  // ══════════════════════════════════════════════════════════════════════

  async currentBets({ actor, matchStatus, betType, channel, limit, offset }) {
    const scope = await this.#scope(actor);
    const where = `${IN_SCOPE} AND ${MATCH_STATUS_SQL[matchStatus]} AND ${BET_TYPE_SQL[betType]} AND ${CHANNEL_SQL[channel] ?? 'TRUE'}`;

    const [rows, [{ total }]] = await Promise.all([
      this.#select(
        `SELECT b.*, u.name AS username
           FROM mssports."SportsBet" b
           JOIN users u ON u.id = b.user_id
          WHERE ${where}
          ORDER BY b.created_at DESC
          LIMIT :limit OFFSET :offset`,
        { ...scope, limit, offset }
      ),
      this.#select(
        `SELECT COUNT(*)::int AS total
           FROM mssports."SportsBet" b
           JOIN users u ON u.id = b.user_id
          WHERE ${where}`,
        scope
      ),
    ]);

    return { rows: rows.map(shapeBet), total };
  }
}

/** DB row → screen row (zip jaise naam). */
function shapeBet(b) {
  return {
    id: String(b.id),
    userId: String(b.user_id),
    username: b.username,
    sportId: b.sport_id ?? null,
    sportName: sportName(b.sport_id) || b.game_type,
    eventId: b.eventid ?? null,
    matchId: b.match_id ?? null,
    eventName: b.match_title,
    marketType: b.market_type || b.game_type,
    gameType: b.game_type,
    selection: b.selection_name,
    betType: String(b.bet_type || '').toLowerCase(),
    odds: b.odds == null ? null : String(b.odds),
    // For the screen: "Match Odds" for MATCH_ODDS, the Bookmaker board as 1.40, a fancy as 55 @ 100.
    marketLabel: marketLabel(b.market_type || b.game_type),
    rate: rateText(b),
    stake: b.stake_amount == null ? '0' : String(b.stake_amount),
    ip: b.ip_address ?? '',
    browser: b.browser ?? '',
    unmatched: b.unmatched === true,
    deleted: b.result_status === 'void',
    createdAt: b.created_at,
  };
}

module.exports = { ExchangeMarketService, shapeBet };

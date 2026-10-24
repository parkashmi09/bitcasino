'use strict';

const { marketLabel } = require('./betLabels');

/**
 * Market book ke pure helpers — zip ke reportsController (getMarketAnalysisDashboard,
 * getMarketAnalysis, getUserBook) ka hisaab, bina DB ke. Service rows laake yahan deta hai.
 *
 * Sign: user_exposures player ki side ka P/L hai. Book (upline) ki side = ulta sign.
 * Zip jaisa: Market Analysis me sab ulta; Game Details me fancy as-is (−100 on 100 stake).
 */

// Sport id → naam (zip utils/sportsNames.js)
const SPORT_NAMES = {
  4: 'Cricket', 1: 'Football', 2: 'Tennis', 8: 'Table Tennis', 68: 'Esoccer', 10: 'Horse Racing',
  65: 'Greyhound Racing', 15: 'Basketball', 69: 'Wrestling', 18: 'Volleyball', 22: 'Badminton',
  59: 'Snooker', 57: 'Darts', 6: 'Boxing', 3: 'Mixed Martial Arts', 58: 'American Football',
  11: 'E Games', 19: 'Ice Hockey', 9: 'Futsal', 40: 'Politics', 67: 'Boat Racing', 52: 'Motor Sports',
  12: 'Greyhounds', 66: 'Kabaddi',
};

const sportName = (sid) => (sid == null || sid === '' ? null : SPORT_NAMES[String(sid).trim()] ?? null);

// zip systemTracker/sportsRule.js ka isFancyMarket (market naam se)
function isFancyMarket(name) {
  const mt = String(name ?? '').toLowerCase();
  if (['fan', 'fancy'].includes(mt)) return true;
  if (mt === 'tied_match' || mt === 'normal') return true;
  return /fancy|session|over by over|khado|meter|badlo|oddeven|wicket|overs line|tied match/.test(mt);
}

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

// 0 ko -0 mat banne do
const flip = (n) => (n === 0 ? 0 : -n);

/**
 * Exposure rows → events (zip dashboard shape).
 *   rows: [{ match_id, event_id, team_name, exposure_amount, match_title, game_type, updated_at }]
 *   meta: Map(eventId → { sportId, startTime })
 *   fancyAsIs: Game Details ke liye — fancy market ka value sign nahi palta
 */
function groupByEvent(rows, meta = new Map(), { fancyAsIs = false } = {}) {
  const events = new Map();

  for (const row of rows) {
    const eventId = String(row.event_id || row.match_id || '');
    if (!eventId) continue;

    if (!events.has(eventId)) {
      events.set(eventId, { eventId, matchId: String(row.match_id ?? ''), title: row.match_title, markets: new Map(), lastUpdated: 0 });
    }
    const event = events.get(eventId);
    event.lastUpdated = Math.max(event.lastUpdated, new Date(row.updated_at || 0).getTime() || 0);

    const name = row.game_type || 'MATCH_ODDS';
    if (!event.markets.has(name)) event.markets.set(name, { name, firstMarketId: String(row.match_id ?? ''), runners: new Map() });
    const market = event.markets.get(name);

    // card order = sabse chhota market id (zip jaisa)
    const mid = String(row.match_id ?? '');
    if (mid.localeCompare(market.firstMarketId, undefined, { numeric: true }) < 0) market.firstMarketId = mid;

    const runner = row.team_name;
    market.runners.set(runner, (market.runners.get(runner) || 0) + Number(row.exposure_amount || 0));
  }

  return [...events.values()].map((event) => ({
    eventId: event.eventId,
    matchId: event.matchId,
    title: event.title || `Match ${event.matchId}`,
    sportId: meta.get(event.eventId)?.sportId ?? null,
    eventDate: meta.get(event.eventId)?.startTime ?? null,
    lastUpdated: event.lastUpdated,
    markets: [...event.markets.values()]
      .sort((a, b) => a.firstMarketId.localeCompare(b.firstMarketId, undefined, { numeric: true }))
      .map((market) => ({
        name: market.name,
        label: marketLabel(market.name),
        rows: [...market.runners.entries()].map(([label, value]) => {
          const keep = fancyAsIs && isFancyMarket(market.name);
          return { label, value: round2(keep ? value : flip(value)) };
        }),
      })),
  }));
}

/**
 * User Book (zip getUserBook) — downline tree: staff rows = neeche walon ka jod (ulta sign,
 * upline side), player rows = apna P/L jaisa stored hai.
 *   exposures: [{ user_id, team_name, exposure_amount }]
 *   users:     [{ id, name, parent_staff_id }]
 *   staffById: Map(id → { id, name, parent_id }) — viewer tak ki chain
 *   viewerId:  login wala staff (tree yahin ruk jata hai)
 */
function buildUserBook(exposures, users, staffById, viewerId) {
  const runners = [];
  const byUser = new Map();

  for (const exp of exposures) {
    const runner = String(exp.team_name || '').trim();
    if (!runners.includes(runner)) runners.push(runner);
    const uid = String(exp.user_id);
    if (!byUser.has(uid)) byUser.set(uid, {});
    const values = byUser.get(uid);
    values[runner] = (values[runner] || 0) + Number(exp.exposure_amount || 0);
  }

  const roots = [];
  const staffNodes = new Map();

  // staff ka node banao (aur uske upar ki chain), viewer pe ruk jao
  const staffNode = (staffId) => {
    if (staffId == null || Number(staffId) === Number(viewerId)) return null;
    const staff = staffById.get(Number(staffId));
    if (!staff) return null;
    if (staffNodes.has(staff.id)) return staffNodes.get(staff.id);
    const node = { id: `S${staff.id}`, username: staff.name, sums: runners.map(() => null), children: [] };
    staffNodes.set(staff.id, node);
    const parent = staffNode(staff.parent_id);
    (parent ? parent.children : roots).push(node);
    return node;
  };

  for (const user of users) {
    const own = byUser.get(String(user.id));
    if (!own) continue;
    const raw = runners.map((r) => (own[r] == null ? null : own[r]));
    const parent = staffNode(user.parent_staff_id);
    (parent ? parent.children : roots).push({
      id: `U${user.id}`,
      username: user.name,
      values: raw.map((v) => (v == null ? null : round2(v))),
    });

    // upar ke har staff me jodo
    let sid = user.parent_staff_id;
    for (let node = parent; node; ) {
      raw.forEach((v, i) => { if (v != null) node.sums[i] = (node.sums[i] || 0) + v; });
      sid = staffById.get(Number(sid))?.parent_id;
      node = staffNode(sid);
    }
  }

  const finish = (node) => {
    if (!node.children) return node;
    const { sums, ...rest } = node;
    return {
      ...rest,
      values: sums.map((v) => (v == null ? null : round2(flip(v)))),
      children: node.children.map(finish),
    };
  };

  return { runners, tree: roots.map(finish) };
}

module.exports = { groupByEvent, buildUserBook, isFancyMarket, sportName };

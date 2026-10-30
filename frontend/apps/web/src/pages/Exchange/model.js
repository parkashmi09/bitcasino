/* View-model helpers for the exchange screens (lobby, My Bets, Statement). Pure functions only —
 * no React, no fetching — so they are unit-tested beside the data layer's (model.test.js) and
 * `react-refresh/only-export-components` stays happy in the page files.
 *
 * Feed shapes are the data layer's: services/exchange/feed.js `EventRow`, docs/exchange.md. */

/** The three lobby boards, in tab order. `sid` is mssports' sport id (etid), `icon` the BetBy
 *  sport-art key the kit's SportIcon resolves (src/assets/sports/sport-<icon>.svg). */
export const LOBBY_SPORTS = [
  { id: 'cricket', sid: 4, label: 'Cricket', icon: 'cricket' },
  { id: 'soccer', sid: 1, label: 'Football', icon: 'soccer' },
  { id: 'tennis', sid: 2, label: 'Tennis', icon: 'tennis' },
];

/** The In-Play view: live matches of all three boards. Uses BetBy's own live glyph. */
export const INPLAY_TAB = 'inplay';

/* sid (mssports etid, = TENEXCH's `icon-<etid>`) → icon key. A key is either a captured BetBy
   file (src/assets/sports/sport-<key>.svg, hash.game's own art) or one of the glyphs drawn in
   components/exchange/icons.jsx (`DRAWN_SPORT_GLYPHS`) for sports BetBy ships no file for.
   Ids verified against the live `all/sports/tree` on 2026-10-14 — note 7 is Beach Volleyball and
   10 is Horse Racing (7 was mapped to horseracing here once). */
const SPORT_ICON = {
  1: 'soccer', 2: 'tennis', 3: 'mma', 4: 'cricket', 5: 'golf', 6: 'boxing', 7: 'beachvolleyball',
  8: 'tabletennis', 9: 'soccer', 10: 'horseracing', 11: 'esports', 15: 'basketball', 16: 'motorbike',
  17: 'chess', 18: 'volleyball', 19: 'icehockey', 22: 'badminton', 29: 'cycling', 32: 'motorbike',
  33: 'athletics', 35: 'blitz-basketball', 37: 'sumo', 38: 'esports', 39: 'handball', 40: 'politics',
  52: 'formula-1', 53: 'baseball', 54: 'rugby', 55: 'rugbyleague', 57: 'darts', 58: 'americanfootball',
  59: 'snooker', 62: 'soccer', 64: 'esports', 65: 'greyhound', 66: 'kabbadi', 67: 'boatracing',
  68: 'fifa-b', 69: 'wrestling',
};

/* Name fallback, for an id the table above does not know yet: the feed's name lower-cased with
   everything but letters and digits stripped ("Ice Hockey" → "icehockey"). */
const SPORT_ICON_BY_NAME = {
  politics: 'politics', election: 'politics', elections: 'politics',
  cricket: 'cricket', football: 'soccer', soccer: 'soccer', futsal: 'soccer',
  tennis: 'tennis', tabletennis: 'tabletennis', badminton: 'badminton',
  basketball: 'basketball', basketball3x3: 'blitz-basketball',
  volleyball: 'volleyball', beachvolleyball: 'beachvolleyball',
  icehockey: 'icehockey', baseball: 'baseball', americanfootball: 'americanfootball',
  rugby: 'rugby', rugbyunion: 'rugby', rugbyleague: 'rugbyleague',
  boxing: 'boxing', mma: 'mma', mixedmartialarts: 'mma', wrestling: 'wrestling',
  golf: 'golf', darts: 'darts', snooker: 'snooker', chess: 'chess', handball: 'handball',
  kabaddi: 'kabbadi', kabbadi: 'kabbadi', sumo: 'sumo', athletics: 'athletics', cycling: 'cycling',
  horseracing: 'horseracing', greyhound: 'greyhound', greyhoundracing: 'greyhound',
  esports: 'esports', egames: 'esports', virtualsports: 'esports', esoccer: 'fifa-b',
  motorsport: 'formula-1', motorsports: 'formula-1', formula1: 'formula-1',
  motogp: 'motorbike', motorbikes: 'motorbike', boatracing: 'boatracing',
};

const nameKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** sid (and optionally the feed's sport name) → icon key for the kit's SportIcon. Id first, then
 *  name; undefined when neither is known (SportIcon's `fallback` then draws the generic glyph). */
export const sportIconOf = (sid, name) =>
  SPORT_ICON[Number(sid)] ?? SPORT_ICON_BY_NAME[nameKey(name)];

/** `/sports/match/:sid/:gmid`, with the price the visitor clicked as query so the match page can
 *  preselect it: `?market=<mid>&runner=<section sid>&side=back|lay`. */
export function matchPath(sid, gmid, pick) {
  const base = `/sports/match/${sid}/${gmid}`;
  if (!pick) return base;
  const q = new URLSearchParams();
  if (pick.market != null) q.set('market', String(pick.market));
  if (pick.runner != null) q.set('runner', String(pick.runner));
  if (pick.side) q.set('side', pick.side);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/* "10/9/2026 10:30:00 AM" — the provider's M/D/YYYY wall clock. Read as the wall clock it is
   (not through `Date.parse`, whose handling of that format is engine-defined), so the lobby
   shows the time the feed printed. */
const STIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;
export function parseFeedTime(value) {
  if (value == null || value === '') return null;
  const m = STIME.exec(String(value).trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let hour = Number(m[4]) % 12;
  if (!m[7]) hour = Number(m[4]);
  else if (m[7].toUpperCase() === 'PM') hour += 12;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]), Number(m[6] || 0));
}

/* "A v B", "A vs B", "A - B" (tennis doubles use " / " inside a side, so it is not a separator). */
export function splitTeams(ename) {
  const name = String(ename ?? '').trim();
  const parts = name.split(/\s+(?:v|vs\.?|-)\s+/i);
  if (parts.length >= 2) return [parts[0].trim(), parts.slice(1).join(' - ').trim()];
  return [name, ''];
}

const isDraw = (nat) => /^(the\s+)?draw$/i.test(String(nat ?? '').trim());
const live = (status) => {
  const s = String(status ?? '').toUpperCase();
  return s === '' || s === 'ACTIVE' || s === 'OPEN';
};

/* Best back / lay of a runner. `oname` arrives as `back1` or `BACK1` depending on the board, and a
   0 price means "no price" (OddsCell renders it as "—"). */
function bestOf(section) {
  const odds = Array.isArray(section?.odds) ? section.odds : [];
  const find = (side) => {
    const o =
      odds.find((x) => String(x.oname).toLowerCase() === `${side}1`) ??
      odds.find((x) => String(x.otype).toLowerCase() === side);
    return o ? { price: Number(o.odds) || 0, size: Number(o.size) || 0 } : { price: 0, size: 0 };
  };
  return { back: find('back'), lay: find('lay') };
}

/**
 * EventRow (all-data board) → the kit's MatchRow `match`, plus what the lobby needs to route a
 * price click (`sid`, `marketId`, `runners`).
 *
 * Runners: section[0] is home, section[1] away, "The Draw" (wherever it sits) is X; a board with
 * no draw runner (tennis, limited-overs cricket) gets `draw: null`, which MatchRow locks as "—".
 * A suspended runner gets no prices; a suspended EVENT locks the whole row (MatchRow `status`).
 */
export function toLobbyMatch(ev, sid) {
  const sections = Array.isArray(ev?.section) ? ev.section : [];
  const drawSec = sections.find((s) => isDraw(s.nat)) ?? null;
  const teamSecs = sections.filter((s) => s !== drawSec);
  const [home, away] = splitTeams(ev?.ename);
  const sideOf = (sec) => (sec && live(sec.gstatus) ? bestOf(sec) : undefined);
  const sportSid = Number(ev?.etid ?? sid);
  return {
    id: String(ev.gmid),
    gmid: ev.gmid,
    sid: sportSid,
    sport: sportIconOf(sportSid),
    competition: ev.cname || 'Other',
    home: home || String(teamSecs[0]?.nat ?? '').trim(),
    away: away || String(teamSecs[1]?.nat ?? '').trim(),
    startTime: parseFeedTime(ev.stime),
    inPlay: Boolean(ev.iplay),
    hasTv: Boolean(ev.tv),
    hasBookmaker: Boolean(ev.bm),
    hasFancy: Boolean(ev.f || ev.f1),
    status: ev.status,
    marketId: ev.mid ?? null,
    runners: { home: teamSecs[0]?.sid ?? null, away: teamSecs[1]?.sid ?? null, draw: drawSec?.sid ?? null },
    odds: {
      home: sideOf(teamSecs[0]),
      away: sideOf(teamSecs[1]),
      draw: drawSec ? sideOf(drawSec) : null,
    },
  };
}

/** Board → { live, upcoming } lobby rows; upcoming sorted by start time (unknown times last).
 *  Upcoming is a start time still ahead: a match that has started without the feed calling it
 *  in-play is in neither list (it was printing "18 Oct 13:30" under Upcoming on the 19th). */
export function splitBoard(events, sid, now = Date.now()) {
  const rows = (Array.isArray(events) ? events : []).filter((e) => e && e.gmid != null).map((e) => toLobbyMatch(e, sid));
  const t = (m) => (m.startTime ? m.startTime.getTime() : Number.MAX_SAFE_INTEGER);
  return {
    live: rows.filter((m) => m.inPlay),
    upcoming: rows.filter((m) => !m.inPlay && t(m) > now).sort((a, b) => t(a) - t(b)),
  };
}

/** A stake value's button label, the server's own convention: 1000 → "1k", 1500 → "1.5k",
 *  100000 → "1L", 500 → "500". */
export function stakeLabel(value) {
  const n = Number(value) || 0;
  const trim = (v) => String(Number(v.toFixed(2)));
  if (n >= 100000) return `${trim(n / 100000)}L`;
  if (n >= 1000) return `${trim(n / 1000)}k`;
  return String(n);
}

/* ─── Statement date range ─── */

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar date → "YYYY-MM-DD" (what `<input type="date">` and the statement API take). */
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The default statement window: the last 7 days including today. */
export function defaultStatementRange(now = new Date()) {
  const from = new Date(now);
  from.setDate(now.getDate() - 6);
  return { from: isoDay(from), to: isoDay(now) };
}

export const MAX_STATEMENT_DAYS = 31;

/** null when the range is usable, else the message to show. The server enforces the same 31
 *  days (maxDateRange(31)); this only saves a round trip that would 400. */
export function statementRangeError(from, to) {
  if (!from || !to) return 'Choose a start and an end date.';
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 'Choose a start and an end date.';
  if (a > b) return 'The start date must be before the end date.';
  const days = Math.round((b - a) / 86400000) + 1;
  if (days > MAX_STATEMENT_DAYS) return `The range can be at most ${MAX_STATEMENT_DAYS} days.`;
  return null;
}

/* ── Racing (Horse Racing 10, Greyhound Racing 65) ─────────────────────────────────────────
   The tree lists their races flat in `racing` (t2): `{ gmid, etid, name: "Venue (CC)",
   sdatetime }`. Shaped here into sport → country → race, the same nesting the sidebar draws for
   every other sport, with each race named "Venue · HH:MM" and the venue/time kept for the board. */
export const RACING_SIDS = new Set([10, 65]);

const COUNTRY_NAMES = {
  AU: 'Australia', GB: 'United Kingdom', UK: 'United Kingdom', IE: 'Ireland', IN: 'India', FR: 'France',
  US: 'United States', NZ: 'New Zealand', ZA: 'South Africa', JP: 'Japan', HK: 'Hong Kong', SG: 'Singapore',
};
const pad2 = (n) => String(n).padStart(2, '0');

export function racingSports(racing) {
  return (Array.isArray(racing) ? racing : [])
    .filter((s) => s?.etid != null && Array.isArray(s.children) && s.children.length > 0)
    .map((sport) => {
      const byCode = new Map();
      for (const r of sport.children) {
        if (r?.gmid == null) continue;
        const raw = String(r.name ?? '');
        const code = raw.match(/\(([A-Z]{2,3})\)\s*$/)?.[1] ?? '';
        const venue = raw.replace(/\s*\([A-Z]{2,3}\)\s*$/, '').trim() || raw;
        const at = parseFeedTime(r.sdatetime);
        const time = at ? `${pad2(at.getHours())}:${pad2(at.getMinutes())}` : '';
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push({ gmid: String(r.gmid), etid: Number(r.etid ?? sport.etid), venue, time, ts: at ? at.getTime() : Infinity, name: time ? `${venue} · ${time}` : venue });
      }
      const children = [...byCode].map(([code, races]) => ({
        cid: `race-${sport.etid}-${code || 'all'}`,
        name: COUNTRY_NAMES[code] ?? (code || 'Other'),
        children: races.sort((a, b) => a.ts - b.ts || a.venue.localeCompare(b.venue)),
      }));
      return { etid: Number(sport.etid), name: sport.name, children };
    });
}

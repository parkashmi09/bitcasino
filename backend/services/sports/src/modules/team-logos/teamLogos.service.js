'use strict';

/**
 * Team name → logo / flag URL, from the in-house Flashscore feed (every sport: `home_logo` /
 * `away_logo` of `/live/:sport` and `/upcoming/:sport`) and the Cricbuzz feed (cricket:
 * `team1_logo` / `team2_logo` of `/live/cricket`, which also lists upcoming "Preview" matches).
 *
 * Neither feed can be asked "the logo of team X", so the service reads the lists, keeps one
 * name → logo map in memory and rebuilds it every REFRESH_MS. The first lookup waits for the
 * first build; later lookups answer from the map while a rebuild runs behind them.
 */

const REFRESH_MS = 10 * 60 * 1000;
// While the map is empty (every read failed: key, Allowed IPs, feed down) retry this soon instead.
const EMPTY_RETRY_MS = 30 * 1000;
const NONE = Object.freeze({ logo: null, matched: null });
const TIMEOUT_MS = 10_000;


/** "Sydney Sixers W" and "Sydney Sixers Women" → the same key; case, spaces, punctuation and a
 *  trailing country tag ("Gangwon (Kor)") ignored. */
function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s*\([a-z]{2,4}\)\s*$/, '')
    .replace(/\bwomen\b|\bwomens\b/g, 'w')
    .replace(/[^a-z0-9]/g, '');
}

/* Fuzzy fallback, for names the feeds spell differently: "Kuching FA" / "Kuching City FC (Mys)",
   "PSN Ngada" / "Ngada", "Alan Wazny" / "Wazny A." (tennis: surname, initials).
   Club words are dropped; a one-letter token matches a word with that initial. Marker tokens name a
   DIFFERENT team ("India" vs "India A", "W", "U19", "XI"), so a side may only carry an unmatched
   marker if the other side carries it too. */
const CLUB_WORDS = new Set(['fc', 'fa', 'sc', 'cf', 'ac', 'afc', 'club', 'city', 'the']);
const MARKERS = /^(a|b|w|u\d{2}|xi|ii|iii|res|reserves|women|womens)$/;

function tokens(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s*\([a-z]{2,4}\)\s*$/, '')
    // "Wazny A." / "Persekabpas P.": a dotted letter is an initial ("a_"), never the marker "A"
    .replace(/\b([a-z])\./g, '$1_')
    .split(/[^a-z0-9_]+/)
    .filter((t) => t && !CLUB_WORDS.has(t))
    .map((t) => (t === 'women' || t === 'womens' ? 'w' : t));
}

// An initial ("a_") matches any word starting with that letter; words must be equal otherwise.
const isInitial = (t) => t.length === 2 && t[1] === '_';
const tokenMatch = (a, b) => a === b || (isInitial(a) && b[0] === a[0]) || (isInitial(b) && a[0] === b[0]);

/** True when every token of the shorter list pairs with a distinct token of the longer, at least
 *  one pair is an exact word of 3+ letters, and the longer list's leftovers carry no marker. */
function fuzzyMatch(q, f) {
  const [short, long] = q.length <= f.length ? [q, f] : [f, q];
  if (!short.length) return false;
  const used = new Set();
  let exact = false;
  for (const t of short) {
    // exact words first, so "A" in "Wazny A." pairs with "Alan", not with a marker elsewhere
    let i = long.findIndex((u, k) => !used.has(k) && u === t);
    if (i < 0) i = long.findIndex((u, k) => !used.has(k) && tokenMatch(t, u));
    if (i < 0) return false;
    if (long[i] === t && t.length >= 3) exact = true;
    used.add(i);
  }
  if (!exact) return false;
  // Player names ("Ezzedine M."): with an initial on either side, every full word must pair up,
  // so "Ben Mertens" never takes "Ben Ezzedine M."; only initials may be left over.
  const initials = short.some(isInitial) || long.some(isInitial);
  return long.every((u, k) => used.has(k) || (!MARKERS.test(u) && (!initials || isInitial(u))));
}

/** Same team: equal keys, or the fuzzy rule above. */
const sameTeam = (qName, qTokens, fName, fTokens) => nameKey(qName) === nameKey(fName) || fuzzyMatch(qTokens, fTokens);

/* Our exchange feed prints start times as the provider's wall clock in IST ("11/26/2026 1:40:00 PM";
   Sydney Sixers W v Melbourne Stars W is 1:40 PM there and 08:10 UTC on Flashscore). An epoch
   (ms or s) or an ISO string is read as such. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function parseStart(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(String(value).trim());
  if (m) {
    let h = Number(m[4]);
    if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0);
    return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]), Number(m[6] || 0)) - IST_OFFSET_MS;
  }
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

/** A sport name as the feed slugs it: "Table Tennis" → "table-tennis"; "soccer" is the feed's "football". */
const sportSlug = (s) => {
  const slug = String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug === 'soccer' ? 'football' : slug;
};

// A card's start time and the feed's may differ a little (delays, rounding); a match further apart is another match.
const START_WINDOW_MS = 3 * 60 * 60 * 1000;
// When only ONE of the two teams matches, the event must start this close to the card's time.
const ONE_SIDE_WINDOW_MS = 30 * 60 * 1000;

function createTeamLogos({ config, logger, fetchImpl = fetch, now = Date.now }) {
  let map = new Map();
  let entries = []; // [{ tokens, hit }] for the fuzzy fallback; doubles pairs ("A/B") left out
  let events = []; // [{ sport, start, home, away }] each side { name, tokens, logo } — for match()
  let fuzzyCache = new Map();
  let builtAt = 0;
  let building = null;

  async function getJson(base, key, path) {
    const r = await fetchImpl(base.replace(/\/$/, '') + path, {
      headers: { 'X-API-Key': key, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`${r.status} on ${path}`);
    return r.json();
  }

  async function build() {
    const next = new Map();
    const nextEntries = [];
    const nextEvents = [];
    const side = (name, logo) => ({ name: String(name ?? ''), tokens: tokens(name), logo: logo || null });
    const addEvent = (sport, startTs, home, homeLogo, away, awayLogo) => {
      if (!home || !away) return;
      const start = startTs > 1e12 ? startTs : startTs * 1000; // Flashscore seconds, Cricbuzz ms
      nextEvents.push({ sport, start, home: side(home, homeLogo), away: side(away, awayLogo) });
    };
    const add = (name, logo) => {
      const k = nameKey(name);
      if (!k || !logo || next.has(k)) return;
      const hit = { logo, matched: String(name) };
      next.set(k, hit);
      if (!String(name).includes('/')) nextEntries.push({ tokens: tokens(name), hit });
    };
    const jobs = [];
    const fsUrl = config.FLASH_SCORE_FLAG_API_URL;
    const fsKey = config.FLASH_SCORE_FLAG_API_KEY;
    if (fsUrl && fsKey) {
      // Every sport the feed has right now (`/sports` → [{ sport: 'football' }, …]), nothing listed here.
      const sports = await getJson(fsUrl, fsKey, '/sports')
        .then((body) => (body?.sports ?? []).map((s) => s?.sport).filter(Boolean))
        .catch((err) => {
          logger?.warn?.({ err: String(err?.message) }, 'team-logos: Flashscore /sports failed');
          return [];
        });
      for (const sport of sports) {
        for (const list of ['live', 'upcoming']) {
          jobs.push(
            getJson(fsUrl, fsKey, `/${list}/${sport}`).then((body) => {
              for (const e of body?.events ?? []) {
                const s = e.scoreboard ?? {};
                add(s.home, s.home_logo_large || s.home_logo);
                add(s.away, s.away_logo_large || s.away_logo);
                addEvent(sport, Number(s.start_ts ?? e.start_ts) || 0, s.home, s.home_logo_large || s.home_logo, s.away, s.away_logo_large || s.away_logo);
              }
            })
          );
        }
      }
    }
    const cbUrl = config.CRICBUZZ_API_URL;
    const cbKey = config.CRICBUZZ_API_KEY;
    if (cbUrl && cbKey) {
      jobs.push(
        getJson(cbUrl, cbKey, '/live/cricket').then((body) => {
          for (const e of body?.events ?? []) {
            const s = e.scoreboard ?? {};
            add(s.team1, s.team1_logo);
            add(s.team2, s.team2_logo);
            addEvent('cricket', Number(s.start_ts) || 0, s.team1, s.team1_logo, s.team2, s.team2_logo);
          }
        })
      );
    }
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) logger?.warn?.({ failed: failed.length, of: jobs.length, first: String(failed[0].reason?.message) }, 'team-logos: some feed reads failed');
    // A rebuild where every read failed keeps the last good map rather than wiping it.
    if (next.size > 0 || map.size === 0) {
      map = next;
      entries = nextEntries;
      events = nextEvents;
      fuzzyCache = new Map();
    }
    builtAt = now();
  }

  function refresh() {
    if (!building) building = build().finally(() => { building = null; });
    return building;
  }

  /** { logo, matched } for a team name — `matched` is the feed's own spelling of the team it was
   *  matched to — or { logo: null, matched: null } when no feed has that team right now. */
  async function fresh() {
    if (builtAt === 0) await refresh();
    else if (now() - builtAt > (map.size ? REFRESH_MS : EMPTY_RETRY_MS)) refresh().catch(() => {});
  }

  async function find(name) {
    await fresh();
    const key = nameKey(name);
    if (map.has(key)) return map.get(key);
    if (String(name).includes('/')) return NONE;
    if (!fuzzyCache.has(key)) {
      const q = tokens(name);
      // Only a single, unambiguous candidate (by logo) counts. With several ("Tampines Rovers" →
      // "Tampines (Sgp)" and "Rovers"), keep the ones carrying the query's FIRST word — the
      // distinguishing name — and still give up unless exactly one team is left.
      const hits = entries.filter((e) => fuzzyMatch(q, e.tokens));
      const byLogo = (list) => new Map(list.map((e) => [e.hit.logo, e.hit]));
      let found = byLogo(hits);
      if (found.size > 1) found = byLogo(hits.filter((e) => e.tokens.includes(q[0])));
      fuzzyCache.set(key, found.size === 1 ? [...found.values()][0] : NONE);
    }
    return fuzzyCache.get(key);
  }

  /**
   * The logos of ONE match: the feed event whose two teams match `home` and `away` (either order)
   * and whose start is within START_WINDOW_MS of `start` (and of `sport`, when the feed has that
   * sport), the closest in time winning. No such event → both logos null, never a guess.
   */
  async function match({ home, away, start, sport }) {
    await fresh();
    const at = parseStart(start);
    const slug = sportSlug(sport);
    const sportKnown = slug && events.some((e) => e.sport === slug);
    const hT = tokens(home);
    const aT = tokens(away);
    let best = null;
    for (const e of events) {
      if (sportKnown && e.sport !== slug) continue;
      const dt = at == null ? 0 : Math.abs(e.start - at);
      if (at != null && dt > START_WINDOW_MS) continue;
      let pair = null;
      if (sameTeam(home, hT, e.home.name, e.home.tokens) && sameTeam(away, aT, e.away.name, e.away.tokens)) pair = [e.home, e.away];
      else if (sameTeam(home, hT, e.away.name, e.away.tokens) && sameTeam(away, aT, e.home.name, e.home.tokens)) pair = [e.away, e.home];
      if (!pair) continue;
      // Prefer the closer start, then the event that actually carries logos.
      const score = dt - (pair[0].logo ? 1 : 0) - (pair[1].logo ? 1 : 0);
      if (!best || score < best.score) best = { score, e, pair };
    }
    // One side only ("Olympiakos" / "Olympiacos Piraeus"): a team plays one match at a time, so the
    // other side is that event's opponent — but only within the card's sport, within 30 minutes,
    // and only when exactly one event qualifies.
    if (!best && sportKnown && at != null) {
      const near = [];
      for (const e of events) {
        if (e.sport !== slug || Math.abs(e.start - at) > ONE_SIDE_WINDOW_MS) continue;
        if (sameTeam(home, hT, e.home.name, e.home.tokens) || sameTeam(away, aT, e.away.name, e.away.tokens)) near.push({ e, pair: [e.home, e.away] });
        else if (sameTeam(home, hT, e.away.name, e.away.tokens) || sameTeam(away, aT, e.home.name, e.home.tokens)) near.push({ e, pair: [e.away, e.home] });
      }
      if (near.length === 1) best = near[0];
    }
    if (!best) return { home: NONE, away: NONE, event: null };
    const hit = (s) => (s.logo ? { logo: s.logo, matched: s.name } : NONE);
    const { e, pair } = best;
    return {
      home: hit(pair[0]),
      away: hit(pair[1]),
      event: { sport: e.sport, start: new Date(e.start).toISOString(), home: e.home.name, away: e.away.name },
    };
  }

  /** Just the logo URL, or null. */
  const lookup = async (name) => (await find(name)).logo;

  return { find, lookup, match, refresh, size: () => map.size };
}

module.exports = { createTeamLogos, nameKey, tokens, fuzzyMatch, parseStart };

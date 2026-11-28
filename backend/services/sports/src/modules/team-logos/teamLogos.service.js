'use strict';

const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

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
const publicHit = (h) => ({ logo: h.logo, matched: h.matched });
const TIMEOUT_MS = 10_000;
const FEED_CONCURRENCY = 6;
// How long a match stays known after the feed drops it (counted from its start): finished
// matches keep their logos for this long.
const KEEP_DROPPED_MS = 3 * 24 * 60 * 60 * 1000;


/** Case, spaces, punctuation and a trailing country tag ("Gangwon (Kor)") ignored. */
function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s*\([a-z]{2,4}\)\s*$/, '')
    .replace(/[^a-z0-9]/g, '');
}

/* Words of a name; a dotted letter is kept as an initial ("Wazny A." → "a_"). No word lists:
   the matching below leans on the data. */
function tokens(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s*\([a-z]{2,4}\)\s*$/, '')
    .replace(/\b([a-z])\./g, '$1_')
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

// A one-letter word, dotted or not ("A.", "W"), stands for a word with that first letter ("Alan", "Women").
const isInitial = (t) => t.length === 1 || (t.length === 2 && t[1] === '_');
const tokenMatch = (a, b) => a === b || (isInitial(a) && b[0] === a[0]) || (isInitial(b) && a[0] === b[0]);

/** Strict: every word of BOTH names pairs up one to one (initials may stand for words), with at
 *  least one real word of 3+ letters. "Alan Wazny" = "Wazny A.", "Sydney Sixers W" = "Sydney Sixers
 *  Women"; "India" ≠ "India A" (one word against two). */
function fullMatch(q, f) {
  if (!q.length || q.length !== f.length) return false;
  const used = new Set();
  let exact = false;
  for (const t of q) {
    let i = f.findIndex((u, k) => !used.has(k) && u === t);
    if (i < 0) i = f.findIndex((u, k) => !used.has(k) && tokenMatch(t, u));
    if (i < 0) return false;
    if (f[i] === t && t.length >= 3) exact = true;
    used.add(i);
  }
  return exact;
}

/** Loose: the two names share a real word of 3+ letters ("Kuching FA" / "Kuching City FC").
 *  Only ever used together with the other team AND the start time, which is what keeps it safe. */
const sharesWord = (q, f) => q.some((t) => t.length >= 3 && !isInitial(t) && f.includes(t));

const strongTeam = (qName, qT, fName, fT) => nameKey(qName) === nameKey(fName) || fullMatch(qT, fT);
const looseTeam = (qName, qT, fName, fT) => strongTeam(qName, qT, fName, fT) || sharesWord(qT, fT);

/** UTC ms of a wall-clock time in an IANA zone ("Asia/Kolkata"), DST-safe. */
function wallClockToUtc(y, mo, d, h, mi, s, zone) {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  if (!zone) return guess;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guess));
  const g = (type) => Number(parts.find((p) => p.type === type)?.value);
  const shown = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return guess - (shown - guess);
}

/* The card's start: our exchange feed's "11/26/2026 1:40:00 PM" is a wall clock in the feed's
   zone (config SPORTS_FEED_TIMEZONE); an epoch (ms or s) or an ISO string is read as such. */
function parseStart(value, zone) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(String(value).trim());
  if (m) {
    let h = Number(m[4]);
    if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0);
    return wallClockToUtc(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]), Number(m[6] || 0), zone);
  }
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

/** "Table Tennis" → "table-tennis", the feed's own slug style; used only when the feed has that slug. */
const sportSlug = (s) => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A card's start time and the feed's may differ a little (delays, rounding); further apart is another match.
const START_WINDOW_MS = 3 * 60 * 60 * 1000;
// When only ONE of the two teams matches, the event must start this close to the card's time.
const ONE_SIDE_WINDOW_MS = 30 * 60 * 1000;

/* The events seen so far, on disk, so a restart (a deploy) does not forget a match that has
   already left the feed's lists — a "final result only" match leaves /upcoming at its start and
   never appears in /live. A JSON file in the OS temp dir unless TEAM_LOGOS_CACHE_FILE says where. */
function fileStore(file, logger) {
  return {
    async load() {
      try {
        return JSON.parse(await fsp.readFile(file, 'utf8'));
      } catch {
        return [];
      }
    },
    async save(events) {
      try {
        const tmp = `${file}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(events));
        await fsp.rename(tmp, file);
      } catch (err) {
        logger?.warn?.({ err: String(err?.message), file }, 'team-logos: could not save the events cache');
      }
    },
  };
}

function createTeamLogos({ config, logger, fetchImpl = fetch, now = Date.now, store }) {
  store ??= fileStore(config.TEAM_LOGOS_CACHE_FILE || path.join(os.tmpdir(), 'parker-team-logos-events.json'), logger);
  let loaded = false;
  let map = new Map();
  let entries = []; // [{ tokens, hit }] for the fuzzy fallback; doubles pairs ("A/B") left out
  let events = []; // [{ sport, start, home, away }] each side { name, tokens, logo } — for match()
  let fuzzyCache = new Map();
  let builtAt = 0;
  let building = null;

  async function getJsonOnce(base, key, path) {
    const r = await fetchImpl(base.replace(/\/$/, '') + path, {
      headers: { 'X-API-Key': key, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw Object.assign(new Error(`${r.status} on ${path}`), { status: r.status });
    return r.json();
  }

  // One retry for a dropped connection / timeout / 5xx (a 4xx — key, IP, unknown id — is final).
  const getJson = (base, key, path) =>
    getJsonOnce(base, key, path).catch((err) => {
      if (err?.status && err.status < 500) throw err;
      return getJsonOnce(base, key, path);
    });

  // At most FEED_CONCURRENCY list reads in flight: firing all ~70 at once dropped some ("fetch failed").
  let inFlight = 0;
  const waiting = [];
  async function limited(fn) {
    if (inFlight >= FEED_CONCURRENCY) await new Promise((resolve) => waiting.push(resolve));
    inFlight += 1;
    try {
      return await fn();
    } finally {
      inFlight -= 1;
      waiting.shift()?.();
    }
  }

  async function build() {
    const next = new Map();
    const nextEntries = [];
    const nextEvents = [];
    const side = (name, logo, flag) => ({ name: String(name ?? ''), tokens: tokens(name), logo: logo || null, flag: flag || null });
    // source + id let match() ask that feed's /event/{id}/logos when the list carried no logo.
    const addEvent = (source, id, sport, startTs, home, away, league) => {
      if (!home.name || !away.name) return;
      const start = startTs > 1e12 ? startTs : startTs * 1000; // Flashscore seconds, Cricbuzz ms
      nextEvents.push({ source, id, sport, start, home: side(home.name, home.logo, home.flag), away: side(away.name, away.logo, away.flag), league });
    };
    // A name both feeds list keeps Flashscore's logo, whichever answer lands first.
    const add = (name, logo, source = 'fs') => {
      const k = nameKey(name);
      if (!k || !logo) return;
      const had = next.get(k);
      if (had && !(had.source === 'cb' && source === 'fs')) return;
      next.set(k, { logo, matched: String(name), source });
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
            limited(() => getJson(fsUrl, fsKey, `/${list}/${sport}`)).then((body) => {
              for (const e of body?.events ?? []) {
                const s = e.scoreboard ?? {};
                // Logo first; a team / player the list has no picture for falls back to its flag.
                add(s.home, s.home_logo_large || s.home_logo || s.home_flag_large || s.home_flag);
                add(s.away, s.away_logo_large || s.away_logo || s.away_flag_large || s.away_flag);
                addEvent('fs', e.event_id ?? s.event_id, sport, Number(s.start_ts ?? e.start_ts) || 0,
                  { name: s.home, logo: s.home_logo_large || s.home_logo, flag: s.home_flag_large || s.home_flag },
                  { name: s.away, logo: s.away_logo_large || s.away_logo, flag: s.away_flag_large || s.away_flag },
                  { name: s.league || null, logo: s.league_logo || null, flag: s.country_flag_large || s.country_flag || null });
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
            add(s.team1, s.team1_logo || s.team1_logo_cricbuzz || s.team1_flag || s.team1_flag_svg, 'cb');
            add(s.team2, s.team2_logo || s.team2_logo_cricbuzz || s.team2_flag || s.team2_flag_svg, 'cb');
            addEvent('cb', e.event_id ?? s.match_id, 'cricket', Number(s.start_ts) || 0,
              { name: s.team1, logo: s.team1_logo || s.team1_logo_cricbuzz, flag: s.team1_flag || s.team1_flag_svg },
              { name: s.team2, logo: s.team2_logo || s.team2_logo_cricbuzz, flag: s.team2_flag || s.team2_flag_svg },
              { name: s.series || null, logo: null, flag: null });
          }
        })
      );
    }
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) logger?.warn?.({ failed: failed.length, of: jobs.length, first: String(failed[0].reason?.message) }, 'team-logos: some feed reads failed');
    // First build after a (re)start: the events the last process saw.
    if (!loaded) {
      loaded = true;
      const saved = await store.load();
      if (Array.isArray(saved) && events.length === 0) events = saved;
    }
    const gotData = next.size > 0;
    // A match the feed has dropped (finished, or "final result only" once started) may still be on
    // our board: keep its last known event for KEEP_DROPPED_MS after its start, by name too.
    const seen = new Set(nextEvents.map((e) => `${e.source}:${e.id}`));
    for (const e of events) {
      if (e.id == null || seen.has(`${e.source}:${e.id}`) || now() - e.start >= KEEP_DROPPED_MS) continue;
      nextEvents.push(e);
      for (const sd of [e.home, e.away]) add(sd.name, sd.logo || sd.flag, e.source);
    }
    for (const hit of next.values()) {
      if (!hit.matched.includes('/')) nextEntries.push({ tokens: tokens(hit.matched), hit });
    }
    // A rebuild where every read failed keeps the last good map rather than wiping it.
    if (gotData || map.size === 0) {
      map = next;
      entries = nextEntries;
      events = nextEvents;
      fuzzyCache = new Map();
      if (gotData) store.save(events);
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
    if (map.has(key)) return publicHit(map.get(key));
    if (String(name).includes('/')) return NONE;
    if (!fuzzyCache.has(key)) {
      const q = tokens(name);
      // Only a single, unambiguous candidate (by logo) counts. With several ("Tampines Rovers" →
      // "Tampines (Sgp)" and "Rovers"), keep the ones carrying the query's FIRST word — the
      // distinguishing name — and still give up unless exactly one team is left.
      const hits = entries.filter((e) => fullMatch(q, e.tokens));
      const byLogo = (list) => new Map(list.map((e) => [e.hit.logo, e.hit]));
      let found = byLogo(hits);
      if (found.size > 1) found = byLogo(hits.filter((e) => e.tokens.includes(q[0])));
      fuzzyCache.set(key, found.size === 1 ? publicHit([...found.values()][0]) : NONE);
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
    const at = parseStart(start, config.SPORTS_FEED_TIMEZONE);
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
      if (looseTeam(home, hT, e.home.name, e.home.tokens) && looseTeam(away, aT, e.away.name, e.away.tokens)) pair = [e.home, e.away];
      else if (looseTeam(home, hT, e.away.name, e.away.tokens) && looseTeam(away, aT, e.home.name, e.home.tokens)) pair = [e.away, e.home];
      if (!pair) continue;
      // Prefer strong names, then identical spellings, then the closer start, then the event that
      // carries the most art (team logos, league crest/flag) — two feeds often list the same match.
      const strong = (strongTeam(home, hT, pair[0].name, pair[0].tokens) ? 1 : 0) + (strongTeam(away, aT, pair[1].name, pair[1].tokens) ? 1 : 0);
      const same = (nameKey(home) === nameKey(pair[0].name) ? 1 : 0) + (nameKey(away) === nameKey(pair[1].name) ? 1 : 0);
      const art = (pair[0].logo ? 1 : 0) + (pair[1].logo ? 1 : 0) + (e.league?.logo || e.league?.flag ? 1 : 0);
      const score = dt - strong * START_WINDOW_MS - same * 60_000 - art;
      if (!best || score < best.score) best = { score, e, pair };
    }
    // One side only ("Olympiakos" / "Olympiacos Piraeus"): a team plays one match at a time, so the
    // other side is that event's opponent — but only within the card's sport, within 30 minutes,
    // and only when exactly one event qualifies.
    if (!best && at != null) {
      const near = [];
      for (const e of events) {
        if ((sportKnown && e.sport !== slug) || Math.abs(e.start - at) > ONE_SIDE_WINDOW_MS) continue;
        if (strongTeam(home, hT, e.home.name, e.home.tokens) || strongTeam(away, aT, e.away.name, e.away.tokens)) near.push({ e, pair: [e.home, e.away] });
        else if (strongTeam(home, hT, e.away.name, e.away.tokens) || strongTeam(away, aT, e.home.name, e.home.tokens)) near.push({ e, pair: [e.away, e.home] });
      }
      if (near.length === 1) best = near[0];
    }
    // No event (the feed never had it, or dropped it before we saw it): each side's logo by its
    // name alone, from any match we know — strict, unique matches only (see find()).
    if (!best) return { home: await find(home), away: await find(away), event: null, league: null };
    const { e, pair } = best;
    // A side the list left without a logo (a lesser player's photo): ask the match's own
    // /event/{id}/logos, which the feed looks up live; then the side's country flag.
    const extra = !pair[0].logo || !pair[1].logo || !(e.league?.logo || e.league?.flag) ? await eventLogos(e) : null;
    const hit = (s) => {
      const more = extra ? (s === e.home ? extra.home : extra.away) : null;
      const logo = s.logo || more?.logo || s.flag || more?.flag;
      return logo ? { logo, matched: s.name } : NONE;
    };
    return {
      home: hit(pair[0]),
      away: hit(pair[1]),
      event: { sport: e.sport, start: new Date(e.start).toISOString(), home: e.home.name, away: e.away.name },
      // The league's crest, else its country's flag (the list's, then the event's own /logos).
      league: {
        name: e.league?.name ?? null,
        logo: e.league?.logo || extra?.league?.logo || null,
        flag: e.league?.flag || extra?.league?.flag || null,
      },
    };
  }

  // /event/{id}/logos answers, per event, kept for REFRESH_MS. Flashscore: home/away; Cricbuzz: team1/team2.
  const eventLogoCache = new Map();
  function eventLogos(e) {
    if (e.id == null) return null;
    const ck = `${e.source}:${e.id}`;
    const hitC = eventLogoCache.get(ck);
    if (hitC && now() - hitC.at < REFRESH_MS) return hitC.value;
    const base = e.source === 'cb' ? [config.CRICBUZZ_API_URL, config.CRICBUZZ_API_KEY] : [config.FLASH_SCORE_FLAG_API_URL, config.FLASH_SCORE_FLAG_API_KEY];
    if (!base[0] || !base[1]) return null;
    const pick = (t) => ({ logo: t?.logo || t?.logo_cricbuzz || t?.logo_small || null, flag: t?.flag || t?.flag_svg || null });
    const value = getJson(base[0], base[1], `/event/${encodeURIComponent(e.id)}/logos`)
      .then((b) => ({ home: pick(b?.home ?? b?.team1), away: pick(b?.away ?? b?.team2), league: pick(b?.league ?? b?.series) }))
      .catch(() => null);
    eventLogoCache.set(ck, { at: now(), value });
    return value;
  }

  /** Just the logo URL, or null. */
  const lookup = async (name) => (await find(name)).logo;

  return { find, lookup, match, refresh, size: () => map.size };
}

module.exports = { createTeamLogos, nameKey, tokens, fullMatch, sharesWord, parseStart };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTeamLogos, nameKey } = require('../teamLogos.service');

// A store per instance, so no test reads another's saved events (the real one is a file).
const mem = (data = []) => ({ load: async () => data, save: async (e) => { data.length = 0; data.push(...e); } });
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
// The feed's own sport list (`/sports`); the service reads it instead of a list of its own.
const withSports = (fn) => async (url, opts) =>
  url.endsWith('/sports') ? json({ sports: [{ sport: 'cricket' }, { sport: 'football' }] }) : fn(url, opts);

test('nameKey folds case, punctuation and a trailing country tag', () => {
  assert.equal(nameKey('Gangwon (Kor)'), nameKey('gangwon'));
  assert.equal(nameKey('Abu Dhabi Knight-Riders'), 'abudhabiknightriders');
  assert.notEqual(nameKey('India'), nameKey('India A'));
});

test('?name= is strict: every word pairs up (initials allowed), unique — never India ↔ India A, no word lists', async () => {
  const feed = [
    ['Gangwon (Kor)', 'gw.png'], ['Kuching City FC (Mys)', 'ku.png'], ['Persekabpas P.', 'pp.png'],
    ['Wazny A.', 'wa.png'], ['Radjenovic V./Wazny A.', 'dbl.png'], ['India A', 'ia.png'],
  ];
  const fetchImpl = async (url) =>
    url === 'http://fs/live/football'
      ? json({ events: feed.map(([home, home_logo]) => ({ scoreboard: { home, home_logo } })) })
      : json({ events: [] });
  const logos = createTeamLogos({ store: mem(),  config: { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k' }, fetchImpl: withSports(fetchImpl) });

  assert.equal(await logos.lookup('Gangwon'), 'gw.png');
  assert.equal(await logos.lookup('Persekabpas Pasuruan'), 'pp.png');
  assert.equal(await logos.lookup('Alan Wazny'), 'wa.png');
  assert.equal(await logos.lookup('India'), null); // only India A is in the feed
  assert.equal(await logos.lookup('Kuching FA'), null); // different words: only /match (with the opponent + time) may pair these
});

test('match(): both teams + start time pick ONE event; other events, far starts and one-sided matches give nothing', async () => {
  const ts = (iso) => Date.parse(iso) / 1000;
  const fetchImpl = async (url) => {
    if (url === 'http://fs/live/cricket') {
      return json({ events: [
        { scoreboard: { home: 'Sydney Sixers W', home_logo: 'ss.png', away: 'Melbourne Stars W', away_logo: 'ms.png', start_ts: ts('2026-11-26T08:10:00Z') } },
        // same teams a week later — must not be picked for today's card
        { scoreboard: { home: 'Sydney Sixers W', home_logo: 'ss-old.png', away: 'Melbourne Stars W', away_logo: 'ms-old.png', start_ts: ts('2026-12-03T08:10:00Z') } },
      ] });
    }
    if (url === 'http://fs/live/football') {
      return json({ events: [
        { scoreboard: { home: 'AC Milan', home_logo: 'milan.png', away: 'Inter', away_logo: 'inter.png', start_ts: ts('2026-11-26T08:10:00Z') } },
        { scoreboard: { home: 'Kuching City FC (Mys)', home_logo: 'ku.png', away: 'Phnom Penh Crown (Cam)', away_logo: 'pp.png', start_ts: ts('2026-11-26T10:00:00Z') } },
      ] });
    }
    return json({ events: [] });
  };
  const logos = createTeamLogos({ store: mem(),  config: { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k', SPORTS_FEED_TIMEZONE: 'Asia/Kolkata' }, fetchImpl: withSports(fetchImpl) });

  // our feed's IST wall clock: 1:40 PM IST = 08:10 UTC; away/home swapped is still the same match
  const m = await logos.match({ home: 'Melbourne Stars W', away: 'Sydney Sixers W', start: '11/26/2026 1:40:00 PM', sport: 'cricket' });
  assert.equal(m.home.logo, 'ms.png');
  assert.equal(m.away.logo, 'ss.png');
  assert.equal(m.event.start, '2026-11-26T08:10:00.000Z');

  // different spellings of BOTH teams, same time → the same match (shared words + time, no word list)
  const k = await logos.match({ home: 'Kuching FA', away: 'Phnom Penh', start: '11/26/2026 3:30:00 PM', sport: 'football' });
  assert.equal(k.home.logo, 'ku.png');
  assert.equal(k.away.logo, 'pp.png');

  // a start 6 hours off is another match
  assert.equal((await logos.match({ home: 'Sydney Sixers W', away: 'Melbourne Stars W', start: '11/26/2026 7:40:00 PM' })).event, null);
  // only one side matching (a player named Milan vs AC Milan) → nothing
  const p = await logos.match({ home: 'Milan Musil', away: 'Adam Svoboda', start: '11/26/2026 1:40:00 PM', sport: 'table tennis' });
  assert.equal(p.event, null);
  assert.equal(p.home.logo, null);
});

test('match(): a side the list left without a logo is filled from that event\'s /event/{id}/logos, then its flag', async () => {
  const start_ts = Date.parse('2026-11-26T08:30:00Z') / 1000;
  const fetchImpl = async (url) => {
    if (url === 'http://fs/live/tennis') {
      return json({ events: [{ event_id: 'zyu', scoreboard: { home: 'Ujvary M.', home_logo: 'uj.png', away: 'Kucukhuseyin C. C.', away_flag: 'tr.png', start_ts } }] });
    }
    if (url === 'http://fs/event/zyu/logos') return json({ home: { logo: 'uj-big.png' }, away: { logo: 'kuc.png', flag: 'tr.png' } });
    return json({ events: [] });
  };
  const sports = async (url, o) => (url.endsWith('/sports') ? json({ sports: [{ sport: 'tennis' }] }) : fetchImpl(url, o));
  const logos = createTeamLogos({ store: mem(),  config: { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k', SPORTS_FEED_TIMEZONE: 'Asia/Kolkata' }, fetchImpl: sports });
  const m = await logos.match({ home: 'Matthias Ujvary', away: 'Cem Christopher Kucukhuseyin', start: '11/26/2026 2:00:00 PM', sport: 'tennis' });
  assert.equal(m.home.logo, 'uj.png'); // the list's own logo stays first
  assert.equal(m.away.logo, 'kuc.png'); // filled from /event/zyu/logos
});

test('a match the feed drops (finished) keeps its logos for a while after its start', async () => {
  const start_ts = Date.parse('2026-11-26T08:10:00Z') / 1000;
  let listed = true;
  let t = Date.parse('2026-11-26T09:00:00Z');
  const fetchImpl = async (url) =>
    url === 'http://fs/live/cricket' && listed
      ? json({ events: [{ event_id: 'w1', scoreboard: { home: 'Sydney Sixers W', home_logo: 'ss.png', away: 'Melbourne Stars W', away_logo: 'ms.png', start_ts } }] })
      : json({ events: [] });
  const logos = createTeamLogos({ store: mem(),  config: { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k', SPORTS_FEED_TIMEZONE: 'Asia/Kolkata' }, fetchImpl: withSports(fetchImpl), now: () => t });
  const q = { home: 'Sydney Sixers W', away: 'Melbourne Stars W', start: '11/26/2026 1:40:00 PM', sport: 'cricket' };
  assert.equal((await logos.match(q)).home.logo, 'ss.png');
  listed = false; // match over, gone from the live list
  t += 60 * 60 * 1000;
  await logos.refresh();
  assert.equal((await logos.match(q)).home.logo, 'ss.png');
});

test('no picture in the list → the team / player flag (Flashscore *_flag_large, Cricbuzz flag), by name and by match', async () => {
  const start_ts = Date.parse('2026-11-26T11:15:00Z') / 1000;
  const fetchImpl = async (url) => {
    if (url === 'http://fs/live/cricket') {
      return json({ events: [{ scoreboard: { home: 'Buhrova P./Kantemyr Y.', home_flag: 'ua.png', home_flag_large: 'ua-big.png', away: 'Kelly S./Tolman L.', away_flag: 'en.png', start_ts } }] });
    }
    if (url === 'http://cb/live/cricket') {
      return json({ events: [{ scoreboard: { team1: 'Nepal', team1_flag_svg: 'np.svg', team2: 'Oman', team2_logo_cricbuzz: 'om.jpg', start_ts: start_ts * 1000 } }] });
    }
    return json({ events: [] });
  };
  const config = { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k', CRICBUZZ_API_URL: 'http://cb', CRICBUZZ_API_KEY: 'k', SPORTS_FEED_TIMEZONE: 'Asia/Kolkata' };
  const logos = createTeamLogos({ store: mem(),  config, fetchImpl: withSports(fetchImpl) });
  const m = await logos.match({ home: 'Polina Buhrova / Yevheniia Kantemyr', away: 'Lizzie Tolman / Sian Kelly', start: '11/26/2026 4:45:00 PM', sport: 'cricket' });
  assert.equal(m.home.logo, 'ua-big.png');
  assert.equal(m.away.logo, 'en.png');
  assert.equal(await logos.lookup('Nepal'), 'np.svg');
  assert.equal(await logos.lookup('Oman'), 'om.jpg');
});

test('a restart remembers matches already gone from the lists (a "final result only" match once started)', async () => {
  const start_ts = Date.parse('2026-11-26T08:30:00Z') / 1000;
  const disk = [];
  let listed = true;
  const t = Date.parse('2026-11-26T08:00:00Z');
  const fetchImpl = async (url) =>
    url === 'http://fs/upcoming/football' && listed
      ? json({ events: [{ event_id: 'fro1', scoreboard: { home: 'Wazny A.', home_logo: 'wa.png', away: 'Paolini A.', away_logo: 'pa.png', start_ts } }] })
      : url === 'http://fs/live/cricket' ? json({ events: [{ scoreboard: { home: 'X', home_logo: 'x.png', away: 'Y', away_logo: 'y.png', start_ts } }] }) : json({ events: [] });
  const config = { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k', SPORTS_FEED_TIMEZONE: 'Asia/Kolkata' };
  const q = { home: 'Alan Wazny', away: 'Andrea Paolini', start: '11/26/2026 2:00:00 PM', sport: 'football' };

  const before = createTeamLogos({ store: mem(disk), config, fetchImpl: withSports(fetchImpl), now: () => t });
  assert.equal((await before.match(q)).home.logo, 'wa.png');
  await new Promise((r) => setImmediate(r)); // let the save land

  listed = false; // started → gone from /upcoming, never in /live
  const after = createTeamLogos({ store: mem(disk), config, fetchImpl: withSports(fetchImpl), now: () => t + 60 * 60 * 1000 });
  const m = await after.match(q);
  assert.equal(m.home.logo, 'wa.png');
  assert.equal(m.away.logo, 'pa.png');
  assert.equal(await after.lookup('Alan Wazny'), 'wa.png'); // by name too
});

test('match(): no event for this pair → each side by its name from other matches; unknown stays null', async () => {
  const start_ts = Date.parse('2026-11-26T08:30:00Z') / 1000;
  const fetchImpl = async (url) =>
    url === 'http://fs/live/football'
      ? json({ events: [{ event_id: 'o1', scoreboard: { home: 'Wazny A.', home_logo: 'wa.png', away: 'Someone B.', away_logo: 'sb.png', start_ts } }] })
      : json({ events: [] });
  const config = { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k', SPORTS_FEED_TIMEZONE: 'Asia/Kolkata' };
  const logos = createTeamLogos({ store: mem(), config, fetchImpl: withSports(fetchImpl) });
  const m = await logos.match({ home: 'Alan Wazny', away: 'Andrea Paolini', start: '11/27/2026 2:00:00 PM', sport: 'football' });
  assert.equal(m.event, null);
  assert.equal(m.home.logo, 'wa.png'); // known from his other match
  assert.equal(m.away.logo, null); // never seen → initials, not a guess
});

test('lookup answers from both feeds; Flashscore large logo wins; unknown is null', async () => {
  const fetchImpl = async (url) => {
    if (url === 'http://fs/upcoming/cricket') {
      return json({ events: [{ scoreboard: { home: 'India', home_logo: 'small.png', home_logo_large: 'big.png', away: 'Sri Lanka A', away_logo: 'sla.png' } }] });
    }
    if (url === 'http://cb/live/cricket') {
      return json({ events: [{ scoreboard: { team1: 'Sydney Sixers Women', team1_logo: 'ss.png', team2: 'India', team2_logo: 'cb-india.png' } }] });
    }
    if (url.startsWith('http://fs/')) return json({ events: [] });
    return json({}, 404);
  };
  const config = { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k', CRICBUZZ_API_URL: 'http://cb', CRICBUZZ_API_KEY: 'k' };
  const logos = createTeamLogos({ store: mem(),  config, fetchImpl: withSports(fetchImpl) });

  assert.equal(await logos.lookup('india'), 'big.png');
  assert.equal(await logos.lookup('Sri Lanka A'), 'sla.png');
  assert.equal(await logos.lookup('Sydney Sixers W'), 'ss.png');
  assert.equal(await logos.lookup('Nobody FC'), null);
});

test('an empty map (every read failed) is retried after 30s, not 10 minutes', async () => {
  let up = false;
  let t = 1;
  const fetchImpl = async (url) => {
    if (!up) throw new Error('403 IP not allowed');
    return url === 'http://fs/live/cricket' ? json({ events: [{ scoreboard: { home: 'Delhi', home_logo: 'd.png' } }] }) : json({ events: [] });
  };
  const config = { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k' };
  const logos = createTeamLogos({ store: mem(),  config, fetchImpl: withSports(fetchImpl), now: () => t });
  assert.equal(await logos.lookup('Delhi'), null);
  up = true;
  t += 31_000;
  await logos.lookup('Delhi'); // kicks the background rebuild
  await logos.refresh();
  assert.equal(await logos.lookup('Delhi'), 'd.png');
});

test('a failed feed read does not throw, and a fully failed rebuild keeps the last map', async () => {
  let up = true;
  let t = 0;
  const fetchImpl = async (url) => {
    if (!up) throw new Error('down');
    return url === 'http://fs/live/cricket' ? json({ events: [{ scoreboard: { home: 'Delhi', home_logo: 'd.png' } }] }) : json({ events: [] });
  };
  const config = { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k' };
  const logos = createTeamLogos({ store: mem(),  config, fetchImpl: withSports(fetchImpl), now: () => t });
  t = 1;
  assert.equal(await logos.lookup('Delhi'), 'd.png');
  up = false;
  await logos.refresh();
  assert.equal(await logos.lookup('Delhi'), 'd.png');
});

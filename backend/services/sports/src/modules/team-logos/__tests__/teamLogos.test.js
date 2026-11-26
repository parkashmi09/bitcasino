'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTeamLogos, nameKey } = require('../teamLogos.service');

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
// The feed's own sport list (`/sports`); the service reads it instead of a list of its own.
const withSports = (fn) => async (url, opts) =>
  url.endsWith('/sports') ? json({ sports: [{ sport: 'cricket' }, { sport: 'football' }] }) : fn(url, opts);

test('nameKey folds case, punctuation and Women/W', () => {
  assert.equal(nameKey('Sydney Sixers Women'), nameKey('sydney sixers W'));
  assert.equal(nameKey('Abu Dhabi Knight-Riders'), 'abudhabiknightriders');
  assert.notEqual(nameKey('India'), nameKey('India A'));
});

test('fuzzy names: country tag, club words, initials — but never India ↔ India A, and doubles skipped', async () => {
  const feed = [
    ['Gangwon (Kor)', 'gw.png'], ['Kuching City FC (Mys)', 'ku.png'], ['Ngada', 'ng.png'],
    ['Persekabpas P.', 'pp.png'], ['Wazny A.', 'wa.png'], ['Radjenovic V./Wazny A.', 'dbl.png'],
    ['India A', 'ia.png'], ['Sydney FC', 'syd1.png'], ['Sydney Sixers', 'syd2.png'],
    ['Tampines (Sgp)', 'tam.png'], ['Rovers', 'rov.png'],
  ];
  const fetchImpl = async (url) =>
    url === 'http://fs/live/football'
      ? json({ events: feed.map(([home, home_logo]) => ({ scoreboard: { home, home_logo } })) })
      : json({ events: [] });
  const logos = createTeamLogos({ config: { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k' }, fetchImpl: withSports(fetchImpl) });

  assert.equal(await logos.lookup('Gangwon'), 'gw.png');
  assert.equal(await logos.lookup('Kuching FA'), 'ku.png');
  assert.equal(await logos.lookup('PSN Ngada'), 'ng.png');
  assert.equal(await logos.lookup('Persekabpas Pasuruan'), 'pp.png');
  assert.equal(await logos.lookup('Alan Wazny'), 'wa.png');
  assert.equal(await logos.lookup('India'), null); // only India A is in the feed
  assert.equal(await logos.lookup('Sydney'), null); // two Sydney teams → ambiguous
  assert.equal(await logos.lookup('Tampines Rovers'), 'tam.png'); // "Rovers" alone loses to the first word
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
      return json({ events: [{ scoreboard: { home: 'AC Milan', home_logo: 'milan.png', away: 'Inter', away_logo: 'inter.png', start_ts: ts('2026-11-26T08:10:00Z') } }] });
    }
    return json({ events: [] });
  };
  const logos = createTeamLogos({ config: { FLASH_SCORE_FLAG_API_URL: 'http://fs', FLASH_SCORE_FLAG_API_KEY: 'k' }, fetchImpl: withSports(fetchImpl) });

  // our feed's IST wall clock: 1:40 PM IST = 08:10 UTC; away/home swapped is still the same match
  const m = await logos.match({ home: 'Melbourne Stars W', away: 'Sydney Sixers W', start: '11/26/2026 1:40:00 PM', sport: 'cricket' });
  assert.equal(m.home.logo, 'ms.png');
  assert.equal(m.away.logo, 'ss.png');
  assert.equal(m.event.start, '2026-11-26T08:10:00.000Z');

  // a start 6 hours off is another match
  assert.equal((await logos.match({ home: 'Sydney Sixers W', away: 'Melbourne Stars W', start: '11/26/2026 7:40:00 PM' })).event, null);
  // only one side matching (a player named Milan vs AC Milan) → nothing
  const p = await logos.match({ home: 'Milan Musil', away: 'Adam Svoboda', start: '11/26/2026 1:40:00 PM', sport: 'table tennis' });
  assert.equal(p.event, null);
  assert.equal(p.home.logo, null);
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
  const logos = createTeamLogos({ config, fetchImpl: withSports(fetchImpl) });

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
  const logos = createTeamLogos({ config, fetchImpl: withSports(fetchImpl), now: () => t });
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
  const logos = createTeamLogos({ config, fetchImpl: withSports(fetchImpl), now: () => t });
  t = 1;
  assert.equal(await logos.lookup('Delhi'), 'd.png');
  up = false;
  await logos.refresh();
  assert.equal(await logos.lookup('Delhi'), 'd.png');
});

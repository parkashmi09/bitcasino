import { describe, it, expect } from 'vitest';
import {
  parseFeedTime,
  splitTeams,
  toLobbyMatch,
  splitBoard,
  matchPath,
  stakeLabel,
  statementRangeError,
} from './model';

/* Rows trimmed from the live boards (:4700, 2026-10-13). */
const TEST_MATCH = {
  gmid: 640154297, etid: 4, cname: 'Test Matches', ename: 'Afghanistan v Bangladesh',
  stime: '10/9/2026 10:30:00 AM', iplay: false, tv: false, bm: true, f: true, status: 'OPEN', mid: 6637445342984,
  section: [
    { sid: 889410, nat: 'Afghanistan', gstatus: 'ACTIVE', odds: [{ oname: 'back1', otype: 'back', odds: 100, size: 12.55 }, { oname: 'lay1', otype: 'lay', odds: 160, size: 2.96 }] },
    { sid: 699321, nat: 'Bangladesh', gstatus: 'ACTIVE', odds: [{ oname: 'back1', otype: 'back', odds: 1.09, size: 72113.54 }, { oname: 'lay1', otype: 'lay', odds: 1.1, size: 8779.64 }] },
    { sid: 855272, nat: 'The Draw', gstatus: 'ACTIVE', odds: [{ oname: 'back1', otype: 'back', odds: 12, size: 37.54 }, { oname: 'lay1', otype: 'lay', odds: 12.5, size: 891.94 }] },
  ],
};
const TENNIS = {
  gmid: 603326176, etid: 2, cname: 'WTA', ename: 'A Kalinskaya - S Zhang', stime: '10/13/2026 7:30:00 PM',
  iplay: true, status: 'OPEN', mid: 1,
  section: [
    { sid: 1, nat: 'A Kalinskaya', gstatus: 'SUSPENDED', odds: [{ oname: 'BACK1', odds: 2, size: 5 }] },
    { sid: 2, nat: 'S Zhang', gstatus: 'OPEN', odds: [{ oname: 'BACK1', odds: 1.5, size: 9 }, { oname: 'LAY1', odds: 1.52, size: 3 }] },
  ],
};

describe('exchange lobby model', () => {
  it('reads the feed wall clock', () => {
    const d = parseFeedTime('10/9/2026 10:30:00 AM');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 9, 10, 30]);
    expect(parseFeedTime('10/13/2026 12:05:00 AM').getHours()).toBe(0);
    expect(parseFeedTime('10/13/2026 12:05:00 PM').getHours()).toBe(12);
    expect(parseFeedTime('')).toBeNull();
  });

  it('splits team names', () => {
    expect(splitTeams('India v Australia')).toEqual(['India', 'Australia']);
    expect(splitTeams('Elena Goodman - Tricia Mar')).toEqual(['Elena Goodman', 'Tricia Mar']);
    expect(splitTeams('Solo')).toEqual(['Solo', '']);
  });

  it('maps runners, draw and prices', () => {
    const m = toLobbyMatch(TEST_MATCH, 4);
    expect(m).toMatchObject({ id: '640154297', sid: 4, sport: 'cricket', home: 'Afghanistan', away: 'Bangladesh', hasBookmaker: true, hasFancy: true, marketId: 6637445342984 });
    expect(m.runners).toEqual({ home: 889410, away: 699321, draw: 855272 });
    expect(m.odds.draw).toEqual({ back: { price: 12, size: 37.54 }, lay: { price: 12.5, size: 891.94 } });
    expect(m.odds.away.back.price).toBe(1.09);
  });

  it('locks a suspended runner and has no draw on a two-way board', () => {
    const m = toLobbyMatch(TENNIS, 2);
    expect(m.odds.home).toBeUndefined();
    expect(m.odds.draw).toBeNull();
    expect(m.odds.away).toEqual({ back: { price: 1.5, size: 9 }, lay: { price: 1.52, size: 3 } });
  });

  it('splits a board into live and upcoming', () => {
    const before = Date.UTC(2026, 9, 1);
    const { live, upcoming } = splitBoard([TEST_MATCH, TENNIS, null, { ename: 'no gmid' }], 4, before);
    expect(live.map((m) => m.id)).toEqual(['603326176']);
    expect(upcoming.map((m) => m.id)).toEqual(['640154297']);
    // Started, not in-play → no longer upcoming.
    expect(splitBoard([TEST_MATCH], 4, Date.UTC(2026, 9, 19)).upcoming).toEqual([]);
    expect(splitBoard(undefined, 4)).toEqual({ live: [], upcoming: [] });
  });

  it('builds the match path with the clicked price', () => {
    expect(matchPath(4, 1)).toBe('/sports/match/4/1');
    expect(matchPath(4, 1, { market: 9, runner: 8, side: 'lay' })).toBe('/sports/match/4/1?market=9&runner=8&side=lay');
  });

  it('labels stakes and checks the statement range', () => {
    expect([500, 1000, 1500, 25000, 100000].map(stakeLabel)).toEqual(['500', '1k', '1.5k', '25k', '1L']);
    expect(statementRangeError('2026-10-01', '2026-10-31')).toBeNull();
    expect(statementRangeError('2026-10-01', '2026-11-01')).toMatch(/31/);
    expect(statementRangeError('2026-10-05', '2026-10-01')).toMatch(/before/);
  });
});

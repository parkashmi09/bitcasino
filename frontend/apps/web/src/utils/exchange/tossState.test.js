// Toss detection, from the market-list shapes actually served on 2026-09-12.
// The feed has no toss field — see utils/tossState.js for why these shapes are
// the signal, and which matches proved each branch.

import { describe, it, expect } from 'vitest';
import { isTossDone, battingFirstSide, tossMarketRows } from './tossState';

// ── Fixtures trimmed from real get-match-private-data responses ─────────────

// Women's CPL, gmid 816760588, ~15h before its 7:30 PM start: toss market live,
// advance fancy quoted for BOTH sides.
const preToss = [
  { mname: 'MATCH_ODDS', gtype: 'match', section: [{ nat: 'Guyana Amazon Warriors W' }, { nat: 'Trinbago Knight Riders W' }] },
  {
    mname: 'Normal', gtype: 'fancy', section: [
      { nat: '6 over run GAW W adv', odds: [{ oname: 'back1', odds: 40 }, { oname: 'lay1', odds: 38 }] },
      { nat: '6 over run TKR W adv', odds: [{ oname: 'back1', odds: 46 }, { oname: 'lay1', odds: 44 }] },
      { nat: '20 over run GAW W adv', odds: [{ oname: 'back1', odds: 135 }, { oname: 'lay1', odds: 132 }] },
    ],
  },
  {
    mname: 'fancy1', gtype: 'fancy1', section: [
      { nat: 'GAW W Will Win Toss', odds: [{ oname: 'back1', odds: 1.97 }, { oname: 'lay1', odds: 0 }] },
      { nat: 'TKR W Will Win Toss', odds: [{ oname: 'back1', odds: 1.97 }, { oname: 'lay1', odds: 0 }] },
    ],
  },
];

// Men's CPL, gmid 500320709, 15 min before its 4:30 AM start: no fancy1, every
// first-innings row names TKR, Over By Over + Ball By Ball present.
const postToss = [
  { mname: 'MATCH_ODDS', gtype: 'match', section: [{ nat: 'Guyana Amazon Warriors' }, { nat: 'Trinbago Knight Riders' }] },
  { mname: 'Bookmaker', gtype: 'match1', status: 'SUSPENDED', section: [{ nat: 'Guyana Amazon Warriors' }] },
  {
    mname: 'Normal', gtype: 'fancy', section: [
      { nat: '6 over run TKR adv', odds: [{ oname: 'back1', odds: 49 }] },
      // The rate-style twin of the same line, quoted alongside it once the
      // match is in play (live 04:39, gmid 500320709). It must NOT read as a
      // second team name.
      { nat: '6 over run bhav TKR adv', odds: [{ oname: 'back1', odds: 55 }] },
      { nat: '20 over run TKR adv', odds: [{ oname: 'back1', odds: 161 }] },
      { nat: '20 over run TKR 2 adv', odds: [{ oname: 'back1', odds: 160 }] },
      { nat: '1.3 over run TKR', odds: [{ oname: 'back1', odds: 10 }] },
      { nat: 'Match 1st over run', odds: [{ oname: 'back1', odds: 6 }] },
    ],
  },
  { mname: 'Over By Over', gtype: 'fancy', section: [{ nat: 'Only 1 over run TKR', odds: [{ oname: 'back1', odds: 6 }] }] },
  { mname: 'Ball By Ball', gtype: 'fancy', section: [{ nat: '0.1 ball run TKR', odds: [{ oname: 'back1', odds: 1 }] }] },
  { mname: 'khado', gtype: 'khado', section: [{ nat: '6 over Khado run TKR adv - 11', odds: [{ oname: 'back1', odds: 45 }] }] },
];

// The four no-fancy1 decoys that the naive "no toss rows" check got wrong:
// a stale fixture, a 2020 junk row, and two e-cricket "(e)" matches.
const staleFixture = [
  { mname: 'MATCH_ODDS', gtype: 'match', section: [{ nat: 'England' }, { nat: 'Pakistan' }] },
  { mname: 'Bookmaker', gtype: 'match1', status: 'SUSPENDED', section: [{ nat: 'England' }] },
];
const eCricket = [
  { mname: 'Mumbai Indians (e)  Inning EvenOdd', gtype: 'match', status: 'SUSPENDED', section: [{ nat: 'Odd' }, { nat: 'Even' }] },
];

describe('tossMarketRows', () => {
  it('finds the toss rows pre-toss and none after', () => {
    expect(tossMarketRows(preToss).map((r) => r.nat)).toEqual(['GAW W Will Win Toss', 'TKR W Will Win Toss']);
    expect(tossMarketRows(postToss)).toEqual([]);
  });
});

describe('battingFirstSide', () => {
  it('names the side once the first-innings fancy has settled on one team', () => {
    expect(battingFirstSide(postToss)).toBe('TKR');
  });

  it('stays null while both sides are quoted', () => {
    expect(battingFirstSide(preToss)).toBeNull();
  });

  it('stays null when there is no advance fancy at all', () => {
    expect(battingFirstSide(staleFixture)).toBeNull();
    expect(battingFirstSide(eCricket)).toBeNull();
  });
});

describe('isTossDone', () => {
  it('is false while the toss market is still priced', () => {
    expect(isTossDone(preToss)).toBe(false);
  });

  it('is true on the post-toss shape, even with iplay still false', () => {
    expect(isTossDone(postToss)).toBe(true);
  });

  it('is false for the decoys that merely lack a toss market', () => {
    expect(isTossDone(staleFixture)).toBe(false);
    expect(isTossDone(eCricket)).toBe(false);
  });

  it('is false for empty or missing input rather than guessing', () => {
    expect(isTossDone([])).toBe(false);
    expect(isTossDone(null)).toBe(false);
    expect(isTossDone(undefined)).toBe(false);
  });

  it('needs a LIVE toss row to call it pending — a dead 0-priced row does not count', () => {
    // Once the provider zeroes the toss rows but leaves them in place, the
    // post-toss shape (Over By Over) decides.
    const zeroed = [
      { mname: 'fancy1', gtype: 'fancy1', section: [{ nat: 'GAW Will Win Toss', odds: [{ oname: 'back1', odds: 0 }] }] },
      { mname: 'Over By Over', gtype: 'fancy', section: [{ nat: 'Only 1 over run TKR', odds: [{ oname: 'back1', odds: 6 }] }] },
    ];
    expect(isTossDone(zeroed)).toBe(true);
  });
});

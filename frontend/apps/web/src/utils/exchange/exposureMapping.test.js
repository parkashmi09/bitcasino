// Exposure rows → `${mid}:${runner}` map.
//
// The bug this guards: a name-only match leaked one market's book into every
// market sharing a runner name (tennis — the same two players appear in
// MATCH_ODDS, Bookmaker and set winners).

import { describe, it, expect } from 'vitest';
import { mapMatchExposures } from './exposureMapping';

const markets = [
  {
    mid: '5796311266856', mname: 'MATCH_ODDS', gtype: 'match',
    section: [{ nat: 'Namibia' }, { nat: 'South Africa' }],
  },
  {
    mid: '4656136813901', mname: 'Bookmaker', gtype: 'match1',
    section: [{ nat: 'Namibia' }, { nat: 'South Africa' }],
  },
  {
    mid: '643289348143', mname: 'Normal', gtype: 'fancy',
    section: [{ nat: '10 over run NAM adv' }],
  },
];

describe('mapMatchExposures', () => {
  it('keys on market id + runner, lower-cased', () => {
    const map = mapMatchExposures(
      [{ match_id: '4656136813901', game_type: 'Bookmaker', team_name: 'Namibia', exposure_amount: '769' }],
      markets,
    );
    expect(map).toEqual({ '4656136813901:namibia': 769 });
  });

  it('falls back to game_type = market name when the stored id differs', () => {
    const map = mapMatchExposures(
      [{ match_id: '7547772858252', game_type: 'MATCH_ODDS', team_name: 'South Africa', exposure_amount: -100 }],
      markets,
    );
    expect(map).toEqual({ '5796311266856:south africa': -100 });
  });

  it('never lands a Bookmaker row on MATCH_ODDS through the family fallback', () => {
    const map = mapMatchExposures(
      [{ match_id: 'unknown', game_type: 'Bookmaker 2', team_name: 'Namibia', exposure_amount: 50 }],
      markets,
    );
    // Family BOOKMAKER → the bookmaker market, not the match-odds one.
    expect(map).toEqual({ '4656136813901:namibia': 50 });
  });

  it('sums several rows for the same market and runner', () => {
    const map = mapMatchExposures(
      [
        { match_id: '4656136813901', game_type: 'Bookmaker', team_name: 'Namibia', exposure_amount: 769 },
        { match_id: '4656136813901', game_type: 'Bookmaker', team_name: 'Namibia', exposure_amount: -269.5 },
      ],
      markets,
    );
    expect(map).toEqual({ '4656136813901:namibia': 499.5 });
  });

  it('drops rows with no runner name or an unusable amount', () => {
    const map = mapMatchExposures(
      [
        { match_id: '4656136813901', game_type: 'Bookmaker', team_name: '', exposure_amount: 100 },
        { match_id: '4656136813901', game_type: 'Bookmaker', team_name: 'Namibia', exposure_amount: 'abc' },
      ],
      markets,
    );
    expect(map).toEqual({});
  });

  it('returns an empty map when either side is missing', () => {
    expect(mapMatchExposures([], markets)).toEqual({});
    expect(mapMatchExposures([{ team_name: 'Namibia', exposure_amount: 1 }], [])).toEqual({});
    expect(mapMatchExposures(null, null)).toEqual({});
  });

  it('keeps a zero book — it is a real value, not "no bet"', () => {
    const map = mapMatchExposures(
      [{ match_id: '643289348143', game_type: 'fancy', team_name: '10 over run NAM adv', exposure_amount: 0 }],
      markets,
    );
    expect(map).toEqual({ '643289348143:10 over run nam adv': 0 });
  });
});

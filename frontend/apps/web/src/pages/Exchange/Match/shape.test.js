import { describe, it, expect } from 'vitest';
import { marketTitle, rowStatus, raceCountdownText } from './shape';

describe('marketTitle', () => {
  it('reads feed codes, keeps named markets as they are', () => {
    expect(marketTitle({ mname: 'MATCH_ODDS' })).toBe('Match Odds');
    expect(marketTitle({ mname: 'OVER_UNDER_15' })).toBe('Over/Under 1.5');
    expect(marketTitle({ mname: '10 over run AFG adv' })).toBe('10 over run AFG adv');
    expect(marketTitle({ mname: 'Bookmaker' })).toBe('Bookmaker');
  });
});

describe('rowStatus — racecard (dtype 12) ignores the market SUSPENDED (doc bugs #8/#10)', () => {
  const runner = { gstatus: 'ACTIVE', odds: [{ otype: 'back', odds: 3.1, tno: 0 }] };
  it('a dtype 12 race keeps trading under a SUSPENDED market status', () => {
    expect(rowStatus({ dtype: 12, gtype: 'match', status: 'SUSPENDED' }, runner)).toBeNull();
  });
  it('a runner of its own non-ACTIVE status is still locked', () => {
    expect(rowStatus({ dtype: 12, gtype: 'match', status: 'SUSPENDED' }, { ...runner, gstatus: 'SUSPENDED' })).toBe('SUSPENDED');
  });
  it('any other market (cricket MO dtype 4, MATCH_BET dtype 15) still follows the market status', () => {
    expect(rowStatus({ dtype: 4, gtype: 'match', status: 'SUSPENDED' }, runner)).toBe('SUSPENDED');
    expect(rowStatus({ dtype: 15, gtype: 'match', status: 'SUSPENDED' }, runner)).toBe('SUSPENDED');
  });
});

describe('raceCountdownText — TENEXCH RaceTimer wording', () => {
  const t0 = Date.UTC(2026, 9, 21, 8, 0, 0);
  it('hours + minutes far out, minutes + seconds inside the last hour, null at the off', () => {
    expect(raceCountdownText(t0 + (2 * 3600 + 11 * 60 + 5) * 1000, t0)).toBe('2 Hours 11 Minutes');
    expect(raceCountdownText(t0 + (22 * 60 + 13) * 1000, t0)).toBe('22 Minutes 13 Seconds');
    expect(raceCountdownText(t0, t0)).toBeNull();
  });
});

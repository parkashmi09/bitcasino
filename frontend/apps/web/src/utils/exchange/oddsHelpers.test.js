// Display + P&L helpers shared by every market block and slip.
//
// These are the numbers the player reads (odds, size, book) and the projected
// book the slip shows while typing. Formats were matched to the reference
// exports; the expectations below are those reference strings.

import { describe, it, expect } from 'vitest';
import {
  formatOdd,
  formatSize,
  formatMax,
  formatBookValue,
  formatStake,
  formatAmount,
  classifyMarket,
  isMarketSuspended,
  isSectionSuspended,
  calculateRunnerPL,
  formatPL,
  applyMatchOddsLimits,
  feedMaxStake,
} from './oddsHelpers';

describe('formatSize / formatMax', () => {
  it('shortens thousands and lakhs the way the board does', () => {
    expect(formatSize(10000)).toBe('10K');
    expect(formatSize(4640)).toBe('4.64K');
    expect(formatSize(158.65)).toBe('158.65');
    expect(formatSize(142000)).toBe('1.42L');
  });

  it('prints nothing for an absent size', () => {
    expect(formatSize(0)).toBe('');
    expect(formatSize(null)).toBe('');
    expect(formatSize(undefined)).toBe('');
  });

  it('formats the Max chip, with 0 for no cap', () => {
    expect(formatMax(50000)).toBe('50K');
    expect(formatMax(2000)).toBe('2K');
    expect(formatMax(1)).toBe('1');
    expect(formatMax(0)).toBe('0');
  });
});

describe('formatOdd', () => {
  it('keeps the feed value as-is, without padding', () => {
    expect(formatOdd(1.3)).toBe('1.3');
    expect(formatOdd(1000)).toBe('1000');
    expect(formatOdd(1.24)).toBe('1.24');
  });
});

describe('book / stake / amount', () => {
  it('groups the book in en-IN and keeps the sign', () => {
    expect(formatBookValue(769)).toBe('769');
    expect(formatBookValue(-100)).toBe('-100');
    expect(formatBookValue(3546)).toBe('3,546');
    expect(formatBookValue(0)).toBe('0');
  });

  it('drops fake decimals from a stake ("100.00" → "100")', () => {
    expect(formatStake('100.00')).toBe('100');
    expect(formatStake('100.50')).toBe('100.5');
    expect(formatStake('')).toBe('');
  });

  it('formats money with up to 2 dp and no forced zeros', () => {
    expect(formatAmount(1500)).toBe('1,500');
    expect(formatAmount(12.5)).toBe('12.5');
  });
});

describe('classifyMarket', () => {
  it('routes the market families the blocks switch on', () => {
    expect(classifyMarket({ mname: 'MATCH_ODDS', gtype: 'match' })).toBe('MATCH_ODDS');
    expect(classifyMarket({ mname: 'Bookmaker', gtype: 'match1' })).toBe('BOOKMAKER');
    expect(classifyMarket({ mname: 'Normal', gtype: 'fancy' })).toBe('FANCY');
    expect(classifyMarket({ mname: 'oddeven', gtype: 'oddeven' })).toBe('ODD_EVEN');
    expect(classifyMarket({ mname: '1st Innings 6 Overs Line', gtype: 'fancy2' })).toBe('LINE_MARKET');
  });
});

describe('suspension', () => {
  it('reads the market status, and treats ACTIVE/OPEN rows as bettable', () => {
    expect(isMarketSuspended({ status: 'SUSPENDED' })).toBe(true);
    expect(isMarketSuspended({ status: 'OPEN' })).toBe(false);
    expect(isSectionSuspended({ gstatus: 'ACTIVE' })).toBe(false);
    expect(isSectionSuspended({ gstatus: 'OPEN' })).toBe(false);
    expect(isSectionSuspended({ gstatus: 'SUSPENDED' })).toBe(true);
  });

  it('falls back to "has any live price" when the row carries no status', () => {
    expect(isSectionSuspended({ gstatus: '', odds: [{ otype: 'back', odds: 1.9 }] })).toBe(false);
    expect(isSectionSuspended({ gstatus: '', odds: [{ otype: 'back', odds: 0 }] })).toBe(true);
  });
});

describe('calculateRunnerPL', () => {
  const runners = ['Namibia', 'South Africa'];

  it('prices a decimal back: winner gains stake*(odds-1), the rest lose the stake', () => {
    const pl = calculateRunnerPL(
      { stake: 100, odds: 2.5, betType: 'back', teamName: 'Namibia', marketType: 'MATCH_ODDS' },
      runners,
    );
    expect(pl).toEqual({ Namibia: 150, 'South Africa': -100 });
  });

  it('mirrors it for a lay', () => {
    const pl = calculateRunnerPL(
      { stake: 100, odds: 2.5, betType: 'lay', teamName: 'Namibia', marketType: 'MATCH_ODDS' },
      runners,
    );
    expect(pl).toEqual({ Namibia: -150, 'South Africa': 100 });
  });

  it('treats bookmaker rates as per-100 — the real 769 bookmaker row', () => {
    // Observed 2026-09-12 (GAW v TKR bookmaker): back 100 @ 769 → +769 / -100.
    const pl = calculateRunnerPL(
      { stake: 100, odds: 769, betType: 'back', teamName: 'Namibia', marketType: 'BOOKMAKER' },
      runners,
    );
    expect(pl).toEqual({ Namibia: 769, 'South Africa': -100 });
  });

  it('accepts sub-1 tied-match quotes that decimal markets would refuse', () => {
    const pl = calculateRunnerPL(
      { stake: 100, odds: 0.75, betType: 'back', teamName: 'Namibia', marketType: 'TIED_MATCH' },
      runners,
    );
    expect(pl).toEqual({ Namibia: 0.75, 'South Africa': -100 });
  });

  it('returns nothing when there is no usable stake/odds or fewer than 2 runners', () => {
    expect(calculateRunnerPL({ stake: 0, odds: 2, betType: 'back', teamName: 'Namibia', marketType: 'MATCH_ODDS' }, runners)).toEqual({});
    expect(calculateRunnerPL({ stake: 100, odds: 1, betType: 'back', teamName: 'Namibia', marketType: 'MATCH_ODDS' }, runners)).toEqual({});
    expect(calculateRunnerPL({ stake: 100, odds: 2, betType: 'back', teamName: 'x', marketType: 'MATCH_ODDS' }, ['only'])).toEqual({});
  });

  it('prices the cricketcasino Number grid — the real 9.5 rows', () => {
    // Live 2026-09-12, "2ND INN 6 OVER GAW VS TKR" (gtype cricketcasino,
    // dtype 9, mid 96509981486): ten rows "0 Number".."9 Number", every one
    // quoted 9.5 / size 100. The reference prints 17,000 against the backed row
    // and -2,000 against the other nine for a 2000 stake — CRICKET_CASINO is
    // NOT bookmaker-family, so mult is (odds - 1), not odds/100.
    const grid = Array.from({ length: 10 }, (_, i) => `${i} Number`);
    const pl = calculateRunnerPL(
      { stake: 2000, odds: 9.5, betType: 'back', teamName: '0 Number', marketType: 'CRICKET_CASINO' },
      grid,
    );
    expect(pl['0 Number']).toBe(17000);
    expect(grid.slice(1).map(n => pl[n])).toEqual(Array(9).fill(-2000));
  });
});

describe('formatPL', () => {
  it('prints the projected book the way the row shows it', () => {
    // en-IN grouping, and the colour class the reference uses.
    expect(formatPL(17000)).toEqual({ value: '17,000', className: 'book-green' });
    expect(formatPL(-2000)).toEqual({ value: '-2,000', className: 'book-red' });
    expect(formatPL(12.5)).toEqual({ value: '12.5', className: 'book-green' });
  });

  it('keeps 0 as a real, uncoloured value and prints nothing for absent input', () => {
    expect(formatPL(0)).toEqual({ value: '0', className: '' });
    expect(formatPL(null)).toBeNull();
    expect(formatPL(undefined)).toBeNull();
    expect(formatPL('abc')).toBeNull();
  });
});

describe('applyMatchOddsLimits (TENEXCH: in-play maxb||max, pre-match umaxbof)', () => {
  it('leaves a market without umaxbof, and Bookmaker, untouched', () => {
    const summary = { mname: 'MATCH_ODDS', gtype: 'match', maxb: 1, max: 2000 };
    expect(applyMatchOddsLimits({ ...summary }, '10')).toEqual(summary);
    const bm = { mname: 'Bookmaker', gtype: 'match1', max: 100000, maxb: 0, umaxbof: 0 };
    expect(applyMatchOddsLimits({ ...bm }, '4')).toEqual(bm);
  });

  it('pre-match cricket MO reads umaxbof 1 → Max: 1 (the reference refuses it)', () => {
    const mo = { mname: 'MATCH_ODDS', gtype: 'match', min: 0, max: 2000, maxb: 1, umaxbof: 1, iplay: false };
    expect(applyMatchOddsLimits(mo, '4')).toMatchObject({ max: 1, maxb: 0 });
  });

  it('in-play takes maxb (10K), not the feed max (2K)', () => {
    const mo = { mname: 'MATCH_ODDS', gtype: 'match', max: 2000, maxb: 10000, umaxbof: 1, iplay: true };
    expect(applyMatchOddsLimits(mo, '4').max).toBe(10000);
  });

  it('a race pre-off reads umaxbof 10000 → 10K; in-play its maxb flag 1', () => {
    const race = { mname: 'MATCH_ODDS', gtype: 'match', max: 2000, maxb: 1, umaxbof: 10000 };
    expect(applyMatchOddsLimits({ ...race, iplay: false }, '10').max).toBe(10000);
    expect(applyMatchOddsLimits({ ...race, iplay: true }, '10').max).toBe(1);
  });

  it('live football with max 0 falls back to maxb', () => {
    const fb = { mname: 'OVER_UNDER_15', gtype: 'match', max: 0, maxb: 100000, umaxbof: 1, iplay: true };
    expect(applyMatchOddsLimits(fb, '1').max).toBe(100000);
  });
});

describe('feedMaxStake (mirror of the server feedStakeLimit.mjs)', () => {
  it('in-play maxb (else max), pre-match umaxbof, other markets their own max', () => {
    expect(feedMaxStake({ gtype: 'match', max: 2000, maxb: 1, umaxbof: 1, iplay: false })).toBe(1);
    expect(feedMaxStake({ gtype: 'match', max: 2000, maxb: 10000, umaxbof: 1, iplay: true })).toBe(10000);
    expect(feedMaxStake({ gtype: 'match', max: 2000, maxb: 1, umaxbof: 10000, iplay: false })).toBe(10000);
    expect(feedMaxStake({ gtype: 'match1', max: 100000, maxb: 0, umaxbof: 0 })).toBe(100000);
    expect(feedMaxStake({ gtype: 'fancy2', max: 0, maxb: 1, umaxbof: 1 })).toBe(0);
    expect(feedMaxStake(null)).toBe(0);
  });
});

// Expected values come from Addaplay's own formulas — each case cites the file:line it is
// computed from (paths under /Users/apple/Developer/cfz/admins/frontend-kit/main/Addaplay/src).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addaplayMarketTitle,
  calculateProfit,
  slipProfitLoss,
  calculateExposurePerSelection,
  slipExposureRows,
  validateMinBetAmount,
  validateStakeRange,
  resolveStakeLimits,
  validateUnmatchedOdds,
  isVirtualEvent,
  getBufferSeconds,
  isLockedOddsMarket,
  readLiveSide,
  evaluateBookieFavour,
  isFancyDriftAcceptable,
  resolveGameType,
  violatesRateCap,
  beginBetSubmit,
  endBetSubmit,
  betProfit,
  normaliseBet,
  formatOddAddaplay,
  getRowStatus,
} from './addaplay';

describe('the three odds scales', () => {
  // decimal — betValidation.js:60  s × (o − 1)
  it('decimal (MATCH_ODDS): 1000 @ 2.50 → 1500', () => {
    expect(calculateProfit(2.5, 1000, 'MATCH_ODDS')).toBe(1500);
    expect(calculateProfit(13.5, 100, 'MO')).toBe(1250);
  });
  // percent — betValidation.js:62  s × o / 100 ; TIED_MATCH betValidation.js:61 (o/100) × s
  it('percent (BOOKMAKER / TIED_MATCH): 1000 @ 80 → 800, 100 @ 1000 → 1000, 1000 @ 0.75 → 7.5', () => {
    expect(calculateProfit(80, 1000, 'BOOKMAKER')).toBe(800);
    expect(calculateProfit(1000, 100, 'Bookmaker 2')).toBe(1000);
    expect(calculateProfit(0.75, 1000, 'TIED_MATCH')).toBe(7.5);
  });
  // run line / fancy — betValidation.js:63  returns the stake (Addaplay prices no fancy profit on
  // the slip) ; settled fancy rows price per 100 — betMappers.js:65 (back won s × o / 100)
  it('fancy/run line: slip profit is the stake; settled back win is s × rate / 100', () => {
    expect(calculateProfit(143, 1000, 'FANCY')).toBe(1000);
    expect(betProfit({ resultStatus: 'won', side: 'yes', stake: 1000, odds: 91, gameType: 'FAN' })).toBe(910);
    expect(betProfit({ resultStatus: 'lost', side: 'no', stake: 1000, odds: 91, gameType: 'FAN' })).toBe(-910);
  });
  it('fancy settled on the rate (size), not the run line: YES 55 @ 100, ₹100 won → +100', () => {
    expect(normaliseBet({ result_status: 'won', bet_type: 'yes', stake_amount: 100, odds: 55, size: 100, game_type: 'FAN' }).profit).toBe(100);
    expect(betProfit({ resultStatus: 'lost', side: 'no', stake: 100, odds: 55, size: 90, gameType: 'FAN' })).toBe(-90);
  });
  it('zero odds or stake → 0 (betValidation.js:57)', () => {
    expect(calculateProfit(0, 100, 'MATCH_ODDS')).toBe(0);
    expect(calculateProfit(2, 0, 'MATCH_ODDS')).toBe(0);
  });
});

describe('market title (BetSlip.jsx:84-91)', () => {
  it('maps the feed names', () => {
    expect(addaplayMarketTitle('MATCH_ODDS')).toBe('MATCH_ODDS');
    expect(addaplayMarketTitle('Bookmaker 2')).toBe('BOOKMAKER');
    expect(addaplayMarketTitle('Tied Match')).toBe('MATCH_ODDS'); // :87 — decimal family
    expect(addaplayMarketTitle('TIED_MATCH')).toBe('TIED_MATCH'); // :88
    expect(addaplayMarketTitle('Normal')).toBe('FANCY');
  });
});

describe('slip profit / loss (BetSlip.jsx:93-105)', () => {
  it('back: loss is the stake', () => {
    expect(slipProfitLoss({ odds: 2.5, stake: 1000, betType: 'back', mname: 'MATCH_ODDS' }))
      .toMatchObject({ profit: 1500, loss: 1000, show: true });
  });
  it('lay: loss equals the profit figure (Addaplay verbatim, :94)', () => {
    expect(slipProfitLoss({ odds: 2.5, stake: 1000, betType: 'lay', mname: 'MATCH_ODDS' }))
      .toMatchObject({ profit: 1500, loss: 1500 });
  });
  it('the row shows only for MATCH_ODDS and BOOKMAKER (:104-105)', () => {
    expect(slipProfitLoss({ odds: 80, stake: 100, betType: 'back', mname: 'Bookmaker' }).show).toBe(true);
    expect(slipProfitLoss({ odds: 80, stake: 100, betType: 'back', mname: 'Bookmaker 2' }).show).toBe(false);
    expect(slipProfitLoss({ odds: 1.5, stake: 100, betType: 'back', mname: 'OVER_UNDER_25' }).show).toBe(false);
  });
});

describe('per-runner exposure preview (betValidation.js:65-87)', () => {
  const rows = [{ team: 'A' }, { team: 'B' }];
  it('MO back 1000 @ 2.50 on A → A +1500, B −1000', () => {
    expect(calculateExposurePerSelection(2.5, 1000, 'back', 'MATCH_ODDS', rows, 'A'))
      .toEqual([{ name: 'A', exposure: 1500 }, { name: 'B', exposure: -1000 }]);
  });
  it('MO lay 1000 @ 2.50 on A → A −1500, B +1000', () => {
    expect(calculateExposurePerSelection(2.5, 1000, 'lay', 'MATCH_ODDS', rows, 'A'))
      .toEqual([{ name: 'A', exposure: -1500 }, { name: 'B', exposure: 1000 }]);
  });
  it('BM back 1000 @ 80 on A → A +800, B −1000 (percent, :78)', () => {
    expect(calculateExposurePerSelection(80, 1000, 'back', 'BOOKMAKER', rows, 'A'))
      .toEqual([{ name: 'A', exposure: 800 }, { name: 'B', exposure: -1000 }]);
  });
  it('slip table is empty on fancy and folds yes/no (BetSlip.jsx:73, :153-157)', () => {
    expect(slipExposureRows({ odds: 50, stake: 100, betType: 'yes', mname: 'Normal', runners: ['X'] })).toEqual([]);
    expect(slipExposureRows({ odds: 80, stake: 100, betType: 'no', mname: 'Bookmaker', runners: ['A', 'B'], runnerName: 'A' }))
      .toEqual([{ name: 'A', exposure: -80 }, { name: 'B', exposure: 100 }]);
  });
});

describe('stake rules (betValidation.js:15-42, MatchDetail.jsx:171-172)', () => {
  it('floor 50', () => {
    expect(validateMinBetAmount(49)).toBe('Minimum bet amount is ₹50');
    expect(validateMinBetAmount(50)).toBeNull();
  });
  it('runner/market range, max 0 means no ceiling', () => {
    expect(validateStakeRange(99, 100, 5000)).toBe('Bet amount is below minimum range');
    expect(validateStakeRange(5001, 100, 5000)).toBe('Bet amount exceeds maximum range');
    expect(validateStakeRange(999999, 100, 0)).toBeNull();
  });
  it('runner limit wins, else market', () => {
    expect(resolveStakeLimits({ min: 100, max: 2000 }, { min: 0, max: 25000 })).toEqual({ min: 100, max: 25000 });
  });
  it('manual edit is strict — equal is refused too', () => {
    expect(validateUnmatchedOdds('2.30', '2.30', 'back', true)).toBe('Unmatched bet not allowed');
    expect(validateUnmatchedOdds('2.20', '2.30', 'back', true)).toBeNull();
    expect(validateUnmatchedOdds('2.30', '2.30', 'lay', true)).toBe('Unmatched bet not allowed');
    expect(validateUnmatchedOdds('2.40', '2.30', 'lay', true)).toBeNull();
    expect(validateUnmatchedOdds('9', '2.30', 'back', false)).toBeNull();
  });
  it('virtual leagues are refused (betValidation.js:1, :44-47)', () => {
    expect(isVirtualEvent({ cname: 'T10 XI' })).toBe(true);
    expect(isVirtualEvent({ cname: 'Test Matches' })).toBe(false);
  });
  it('buffer seconds (betValidation.js:3-13)', () => {
    expect(getBufferSeconds(5, 'MATCH_ODDS')).toBe(5);
    expect(getBufferSeconds({ sports: { MATCH_ODDS: 4, Bookmaker: 2 } }, 'BOOKMAKER')).toBe(2);
    expect(getBufferSeconds(null, 'MATCH_ODDS')).toBe(0);
  });
});

describe('bookie favour (autoBetRules.js:89-102) — spec examples A1-A9', () => {
  it.each([
    ['back', 2.30, 2.40, true, 2.40],
    ['back', 2.30, 2.20, false, 2.20],
    ['lay', 2.30, 2.20, true, 2.20],
    ['lay', 2.30, 2.40, false, 2.40],
    ['back', 2.30, 2.30, true, 2.30],
    ['back', 2.30, 2.2995, true, 2.2995],
    ['back', 2.30, 2.298, false, 2.298],
    ['lay', 2.30, 2.3008, true, 2.3008],
    ['back', 80, 95, true, 95],
  ])('%s X=%s Y=%s → %s @ %s', (side, X, Y, accepted, exec) => {
    expect(evaluateBookieFavour(side, X, Y)).toEqual({ accepted, executionOdds: exec });
  });
  it('no live price → accept at X (:92-94)', () => {
    expect(evaluateBookieFavour('back', 2.3, null)).toEqual({ accepted: true, executionOdds: 2.3 });
  });
  it('only fancy / fancy1 are locked (:30-36)', () => {
    expect(isLockedOddsMarket({ gtype: 'fancy' })).toBe(true);
    expect(isLockedOddsMarket({ gtype: 'khado' })).toBe(false);
    expect(isLockedOddsMarket({ mname: 'fancy x' })).toBe(true);
  });
});

describe('live side + fancy drift on the raw feed', () => {
  const markets = [{
    mid: '1', mname: 'MATCH_ODDS', gtype: 'match',
    section: [
      { sid: 11, nat: 'A', gstatus: 'ACTIVE', odds: [
        { oname: 'back1', otype: 'back', odds: 1.98, size: 500 },
        { oname: 'lay1', otype: 'lay', odds: 2.0, size: 300 },
      ] },
      { sid: 12, nat: 'B', gstatus: 'SUSPENDED', odds: [{ oname: 'back1', otype: 'back', odds: 0, size: 0 }] },
    ],
  }, {
    mid: '2', mname: 'Normal', gtype: 'fancy',
    section: [{ sid: 1, nat: '6 over run', gstatus: '', odds: [
      { oname: 'back1', otype: 'back', odds: 46, size: 100 },
      { oname: 'lay1', otype: 'lay', odds: 44, size: 100 },
    ] }],
  }];
  it('reads back1 / lay1 (= transformer backOdds[2] / layOdds[0], autoBetRules.js:71)', () => {
    expect(readLiveSide(markets, { mname: 'MATCH_ODDS', runnerName: 'A' }, 'back'))
      .toEqual({ found: true, suspended: false, odds: 1.98, size: 500 });
    expect(readLiveSide(markets, { mname: 'MATCH_ODDS', runnerName: 'A' }, 'lay').odds).toBe(2.0);
  });
  it('a non-ACTIVE/OPEN runner is suspended with no price (:66-67)', () => {
    expect(readLiveSide(markets, { mname: 'MATCH_ODDS', runnerName: 'B' }, 'back'))
      .toEqual({ found: true, suspended: true, odds: null, size: 0 });
  });
  it('drift: any tier on either side within 0.01 (:110-124)', () => {
    const bet = { mname: 'Normal', runnerName: '6 over run' };
    expect(isFancyDriftAcceptable(markets, bet, 44)).toBe(true); // lay tier
    expect(isFancyDriftAcceptable(markets, bet, 45)).toBe(false);
    expect(isFancyDriftAcceptable(markets, { mname: 'Gone', runnerName: 'x' }, 1)).toBe(true);
  });
});

describe('game type + rate cap (autoBetRules.js:146-177)', () => {
  it('resolves MO / BM / FAN', () => {
    expect(resolveGameType('MATCH_ODDS', 'match')).toEqual({ gameType: 'MO', fancyName: '' });
    expect(resolveGameType('Tied Match', 'match1')).toEqual({ gameType: 'MO', fancyName: '' });
    expect(resolveGameType('Bookmaker 2', 'match1')).toEqual({ gameType: 'BM', fancyName: '' });
    expect(resolveGameType('OVER_UNDER_25', 'match')).toEqual({ gameType: 'MO', fancyName: '' });
    expect(resolveGameType('Normal', 'fancy')).toEqual({ gameType: 'FAN', fancyName: 'FANCY' });
  });
  it('cricket non-Test MATCH_ODDS above 4.00 is refused; Test is exempt', () => {
    expect(violatesRateCap(4.2, { sid: 4, cname: 'ODI' }, 'MATCH_ODDS')).toBe(true);
    expect(violatesRateCap(4.0, { sid: 4, cname: 'T20' }, 'MATCH_ODDS')).toBe(false);
    expect(violatesRateCap(9, { sid: 4, cname: 'Test Matches' }, 'MATCH_ODDS')).toBe(false);
    expect(violatesRateCap(9, { sid: 1, cname: 'EPL' }, 'MATCH_ODDS')).toBe(false);
    expect(violatesRateCap(9, { sid: 4, cname: 'ODI' }, 'BOOKMAKER')).toBe(false);
  });
});

describe('anti-spam: one in-flight submit per key (BetSlip.jsx:485-489)', () => {
  beforeEach(() => endBetSubmit('m|A'));
  it('blocks a second submit until the first ends', () => {
    expect(beginBetSubmit('m|A')).toBe(true);
    expect(beginBetSubmit('m|A')).toBe(false);
    expect(beginBetSubmit('m|B')).toBe(true);
    endBetSubmit('m|A');
    expect(beginBetSubmit('m|A')).toBe(true);
    endBetSubmit('m|B');
  });
});

describe('settled-bet profit (betMappers.js:54-75)', () => {
  it('decimal back won / lost, lay won / lost, void, open', () => {
    expect(betProfit({ resultStatus: 'won', side: 'back', stake: 100, odds: 2.5 })).toBe(150);
    expect(betProfit({ resultStatus: 'lost', side: 'back', stake: 100, odds: 2.5 })).toBe(-100);
    expect(betProfit({ resultStatus: 'won', side: 'lay', stake: 100, odds: 2.5 })).toBe(100);
    expect(betProfit({ resultStatus: 'lost', side: 'lay', stake: 100, odds: 2.5, liability: 150 })).toBe(-150);
    expect(betProfit({ resultStatus: 'void', side: 'lay', stake: 100, odds: 2.5 })).toBe(0);
    expect(betProfit({ resultStatus: null, side: 'back', stake: 100, odds: 2.5 })).toBeNull();
  });
  it('normaliseBet reads the snake_case mssports row', () => {
    const b = normaliseBet({ id: 7, match_title: 'A v B', bet_type: 'back', stake_amount: '100.00', odds: '2.5000', result_status: 'won', game_type: 'MO' });
    expect(b).toMatchObject({ id: 7, matchTitle: 'A v B', side: 'back', stake: 100, odds: 2.5, profit: 150, isWin: true });
  });
});

describe('display (MatchDetail/utils.js:1-30)', () => {
  it('formats odds and row status', () => {
    expect(formatOddAddaplay(2)).toBe('2');
    expect(formatOddAddaplay(1.5)).toBe('1.50');
    expect(formatOddAddaplay(0)).toBe('--');
    expect(getRowStatus({ gstatus: 'Ball Running' })).toBe('BALL RUNNING');
    expect(getRowStatus({ gstatus: 'OPEN' })).toBeNull();
  });
});

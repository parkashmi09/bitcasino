// Live-market checks that stand between Submit and the API call.
//
// Only the two synchronous ones are covered here: the final suspension read and
// the fancy odds-drift check. `monitorOddsBuffer` runs on real timers for
// `bufferSeconds` and needs fake-timer plumbing — it gets its own file later.
//
// Market/runner shapes are trimmed from real get-match-private-data responses
// (2026-09-12, GAW v TKR and Namibia v South Africa).

import { describe, it, expect } from 'vitest';
import { getFinalSuspensionStatus, checkFancyOddsDrift } from './placeBetLiveChecks';

const matchOdds = {
  mid: '5796311266856', mname: 'MATCH_ODDS', gtype: 'match', status: 'OPEN',
  section: [
    { sid: 86630, nat: 'Namibia', gstatus: 'ACTIVE', odds: [{ otype: 'back', oname: 'back1', odds: 9.4, size: 7.8, tno: 0 }] },
    { sid: 67661, nat: 'South Africa', gstatus: 'ACTIVE', odds: [{ otype: 'back', oname: 'back1', odds: 1.11, size: 12597, tno: 0 }] },
  ],
};

// Bookmaker conveys suspension per ROW; its market status is ignored on purpose.
const bookmaker = {
  mid: '4656136813901', mname: 'Bookmaker', gtype: 'match1', status: 'SUSPENDED',
  section: [
    { sid: 1, nat: 'Namibia', gstatus: 'ACTIVE', odds: [{ otype: 'back', oname: 'back1', odds: 769, size: 10000, tno: 0 }] },
    { sid: 2, nat: 'South Africa', gstatus: 'SUSPENDED', odds: [{ otype: 'back', oname: 'back1', odds: 11, size: 50000, tno: 0 }] },
  ],
};

const fancy = {
  mid: '643289348143', mname: 'Normal', gtype: 'fancy', status: 'OPEN',
  section: [
    {
      sid: 1, nat: '10 over run NAM adv', gstatus: '',
      odds: [
        { otype: 'back', oname: 'back1', odds: 44, size: 100, tno: 0 },
        { otype: 'lay', oname: 'lay1', odds: 42, size: 100, tno: 0 },
      ],
    },
    { sid: 2, nat: 'Only 2 over boundaries TKR', gstatus: 'SUSPENDED', odds: [{ otype: 'back', oname: 'back1', odds: 0 }] },
  ],
};

const marketList = [matchOdds, bookmaker, fancy];

describe('getFinalSuspensionStatus', () => {
  it('lets a live runner through', () => {
    expect(getFinalSuspensionStatus({
      marketList, marketId: '5796311266856', selectionId: 86630, runnerName: 'Namibia',
    })).toBeNull();
  });

  it('blocks on the market status for everything except bookmaker', () => {
    const suspendedFancy = { ...fancy, status: 'SUSPENDED' };
    expect(getFinalSuspensionStatus({
      marketList: [suspendedFancy], marketId: '643289348143', runnerName: '10 over run NAM adv',
    })).toBe('SUSPENDED');
  });

  it('ignores the bookmaker market status and reads the row instead', () => {
    // Market says SUSPENDED, the runner is ACTIVE → bettable.
    expect(getFinalSuspensionStatus({
      marketList, marketId: '4656136813901', selectionId: 1, runnerName: 'Namibia',
    })).toBeNull();
    // The other row IS suspended → blocked, and the status is reported back so
    // the caller can pick the right toast.
    expect(getFinalSuspensionStatus({
      marketList, marketId: '4656136813901', selectionId: 2, runnerName: 'South Africa',
    })).toBe('SUSPENDED');
  });

  it('reports BALL RUNNING as itself (it has its own toast)', () => {
    const ballRunning = {
      mid: 'm1', gtype: 'fancy', status: 'OPEN',
      section: [{ sid: 9, nat: 'Only 1 over boundaries TKR', gstatus: 'BALL RUNNING', odds: [] }],
    };
    expect(getFinalSuspensionStatus({
      marketList: [ballRunning], marketId: 'm1', selectionId: 9, runnerName: 'x',
    })).toBe('BALL RUNNING');
  });

  it('matches a fancy row by name when there is no selection id', () => {
    expect(getFinalSuspensionStatus({
      marketList, marketId: '643289348143', selectionId: null, runnerName: 'Only 2 over boundaries TKR',
    })).toBe('SUSPENDED');
  });

  it('says nothing when the market or runner is gone', () => {
    expect(getFinalSuspensionStatus({ marketList, marketId: 'nope', runnerName: 'x' })).toBeNull();
    expect(getFinalSuspensionStatus({
      marketList, marketId: '5796311266856', selectionId: 999, runnerName: 'ghost',
    })).toBeNull();
  });
});

describe('checkFancyOddsDrift', () => {
  const base = { marketList, marketId: '643289348143', runnerName: '10 over run NAM adv' };

  it('passes when the slip price is still quoted, and reports that tier’s size', () => {
    expect(checkFancyOddsDrift({ ...base, betType: 'yes', selectedOdds: 44 }))
      .toEqual({ mismatch: false, liveSize: 100 });
    expect(checkFancyOddsDrift({ ...base, betType: 'no', selectedOdds: 42 }))
      .toEqual({ mismatch: false, liveSize: 100 });
  });

  it('rejects once the price has moved off the slip value', () => {
    expect(checkFancyOddsDrift({ ...base, betType: 'yes', selectedOdds: 47 }).mismatch).toBe(true);
  });

  it('tolerates a 0.01 rounding difference', () => {
    expect(checkFancyOddsDrift({ ...base, betType: 'yes', selectedOdds: 44.01 }).mismatch).toBe(false);
  });

  it('reads the opposite feed side for line markets', () => {
    // "no" normally reads the lay tier (42); inverted it reads back (44).
    expect(checkFancyOddsDrift({ ...base, betType: 'no', selectedOdds: 44, feedSideInverted: true }).mismatch).toBe(false);
    expect(checkFancyOddsDrift({ ...base, betType: 'no', selectedOdds: 42, feedSideInverted: true }).mismatch).toBe(true);
  });

  it('stays silent when the market, row or side has no live tier', () => {
    expect(checkFancyOddsDrift({ ...base, marketId: 'nope', betType: 'yes', selectedOdds: 44 }))
      .toEqual({ mismatch: false, liveSize: null });
    expect(checkFancyOddsDrift({ ...base, runnerName: 'Only 2 over boundaries TKR', betType: 'yes', selectedOdds: 5 }))
      .toEqual({ mismatch: false, liveSize: null });
  });
});

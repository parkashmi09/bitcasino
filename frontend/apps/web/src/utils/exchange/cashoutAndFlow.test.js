// Cashout is TENEXCH (no Addaplay equivalent): expected values are the worked examples in
// tenexch-new/docs/SPORTS_EXCHANGE_MASTER_SPEC.md §8.3. The bet-flow cases check the TENEXCH
// payload contract (§3.1) and Addaplay's validation order (BetSlip.jsx:478-510).
import { describe, it, expect } from 'vitest';
import { buildMarketCashout, computeCashoutClick, marketHasCashoutPosition } from './cashoutUtil';
import { buildBetValue, prevalidateBet, buildPlaceRequest, stakeLimits } from './betFlow';
import { isSectionSuspended } from './oddsHelpers';
import { mapMatchExposures } from './exposureMapping';

const rung = (otype, oname, odds, size = 100) => ({ otype, oname, odds, size });
const twoWay = ({ mname, gtype, a, b, max = 100000, maxb = 0 }) => ({
  mid: '1.24', mname, gtype, min: 100, max, maxb,
  section: [
    { sid: 1, nat: a.name, gstatus: 'ACTIVE', odds: a.odds },
    { sid: 2, nat: b.name, gstatus: 'ACTIVE', odds: b.odds },
  ],
});

describe('cashout (spec §8.3)', () => {
  it('Example 1 — MATCH_ODDS: LAY India @ 2.00, stake 1250 → +250 both ways', () => {
    const market = twoWay({
      mname: 'MATCH_ODDS', gtype: 'match',
      a: { name: 'India', odds: [rung('back', 'back1', 1.98), rung('lay', 'lay1', 2.0)] },
      b: { name: 'Australia', odds: [rung('back', 'back1', 1.95), rung('lay', 'lay1', 1.97)] },
    });
    const r = buildMarketCashout({ market, exposures: { India: 1500, Australia: -1000 } });
    expect(r).toMatchObject({ ok: true, betType: 'lay', team: 'India', odds: 2, stake: 1250, worstBefore: -1000 });
    expect(r.worstAfter).toBeCloseTo(250, 6);
  });

  it('Example 2 — BOOKMAKER (percent): LAY A @ 95, stake 1025.64 → +25.64', () => {
    const market = twoWay({
      mname: 'Bookmaker', gtype: 'match1',
      a: { name: 'A', odds: [rung('back', 'back1', 90), rung('lay', 'lay1', 95)] },
      b: { name: 'B', odds: [rung('back', 'back1', 95), rung('lay', 'lay1', 100)] },
    });
    const r = buildMarketCashout({ market, exposures: { A: 1000, B: -1000 } });
    expect(r).toMatchObject({ ok: true, betType: 'lay', team: 'A', stake: 1025.64, usePercent: true });
    expect(r.worstAfter).toBeCloseTo(25.64, 2);
  });

  it('Example 3 — TIED MATCH: LAY Yes @ 5, stake 990.48 → −9.52', () => {
    const market = twoWay({
      mname: 'Tied Match', gtype: 'match1',
      a: { name: 'Yes', odds: [rung('back', 'back1', 3), rung('lay', 'lay1', 5)] },
      b: { name: 'No', odds: [rung('back', 'back1', 95), rung('lay', 'lay1', 100)] },
    });
    const r = buildMarketCashout({ market, exposures: { Yes: 40, No: -1000 } });
    expect(r).toMatchObject({ ok: true, betType: 'lay', team: 'Yes', stake: 990.48 });
    expect(r.worstAfter).toBeCloseTo(-9.52, 2);
  });

  it('refusals: no position, balanced, above max', () => {
    const market = twoWay({
      mname: 'MATCH_ODDS', gtype: 'match', max: 1000,
      a: { name: 'India', odds: [rung('lay', 'lay1', 2.0)] },
      b: { name: 'Australia', odds: [rung('back', 'back1', 1.95)] },
    });
    expect(buildMarketCashout({ market, exposures: {} }).reason).toBe('no_position');
    expect(buildMarketCashout({ market, exposures: { India: 5, Australia: 5 } }).reason).toBe('already_balanced');
    expect(buildMarketCashout({ market, exposures: { India: 1500, Australia: -1000 } }).reason).toBe('above_max');
  });

  it('the button needs a 2-runner match/match1 market with a book (keys `${mid}:${runner}`)', () => {
    const market = twoWay({
      mname: 'MATCH_ODDS', gtype: 'match',
      a: { name: 'India', odds: [rung('lay', 'lay1', 2.0)] },
      b: { name: 'Australia', odds: [rung('back', 'back1', 1.95)] },
    });
    const book = mapMatchExposures([
      { match_id: '1.24', team_name: 'India', exposure_amount: '1500.00', game_type: 'MATCH_ODDS' },
      { match_id: '1.24', team_name: 'Australia', exposure_amount: '-1000.00', game_type: 'MATCH_ODDS' },
    ], [market]);
    expect(book).toEqual({ '1.24:india': 1500, '1.24:australia': -1000 });
    expect(marketHasCashoutPosition(market, book)).toBe(true);
    const click = computeCashoutClick({ market, marketType: 'MATCH_ODDS', matchExposures: book, matchId: 9 });
    expect(click.betValue).toMatchObject({ is_cashout: true, cashoutStake: 1250, betType: 'lay', team: 'India' });
  });
});

describe('ball running (TENEXCH: status text only)', () => {
  it('ignores the feed br flag: an empty gstatus with live odds is open', () => {
    const s = { br: true, gstatus: '', odds: [rung('back', 'back1', 146)] };
    expect(isSectionSuspended(s)).toBe(false);
  });
  it('a BALL RUNNING status still suspends the row', () => {
    expect(isSectionSuspended({ gstatus: 'BALL RUNNING', odds: [rung('back', 'back1', 146)] })).toBe(true);
  });
});

describe('bet flow', () => {
  const market = {
    mid: 6637445342984, mname: 'MATCH_ODDS', gtype: 'match', min: 0, max: 2000, maxb: 0,
    section: [
      { sid: 11, nat: 'Afghanistan', gstatus: 'ACTIVE', min: 0, max: 0, odds: [rung('back', 'back1', 1.98, 500), rung('lay', 'lay1', 2.0, 300)] },
      { sid: 12, nat: 'Bangladesh', gstatus: 'ACTIVE', min: 0, max: 0, odds: [rung('back', 'back1', 1.9), rung('lay', 'lay1', 1.92)] },
    ],
  };
  const match = { gmid: 640154297, ename: 'Afghanistan v Bangladesh', cname: 'ODI Series', stime: '10/9/2026 10:30:00 AM' };
  const bv = buildBetValue({ market, section: market.section[0], betType: 'back', odds: 1.98, match, sid: 4 });

  it('prevalidateBet: Addaplay sign-in/virtual gates, then TENEXCH stake limits', () => {
    const base = { bv, stake: 100, odds: 1.98, originalOdds: 1.98, match, markets: [market], signedIn: true };
    expect(prevalidateBet({ ...base, signedIn: false }).code).toBe('NOT_SIGNED_IN');
    expect(prevalidateBet({ ...base, match: { ...match, cname: 'T5 XI' } }).code).toBe('VIRTUAL');
    // TENEXCH floor is 100 (doc bug #6: a min of 0 shown, 50 enforced)
    expect(prevalidateBet({ ...base, stake: 99 })).toEqual({ code: 'BELOW_MIN', message: 'Check Minimum Bet Limit.' });
    expect(prevalidateBet({ ...base, stake: 2500 })).toEqual({ code: 'ABOVE_MAX', message: 'Check Maximum Bet Limit1.' });
    expect(prevalidateBet({ ...base, odds: 2.1, isUserModifiedOdds: true }).code).toBe('UNMATCHED');
    expect(prevalidateBet(base)).toBeNull();
    const ballRunning = { ...market, section: [{ ...market.section[0], gstatus: 'BALL RUNNING' }, market.section[1]] };
    expect(prevalidateBet({ ...base, markets: [ballRunning] }).code).toBe('BALL_RUNNING');
    const hi = { ...bv, odds: 4.5 };
    expect(prevalidateBet({ ...base, bv: hi, odds: 4.5, originalOdds: 4.5 }).code).toBe('RATE_CAP');
  });

  it('pre-match Match Odds at the feed cap of 1 answers "Game Not Active2." (doc bug #4), racing a limit toast', () => {
    const pre = { ...market, max: 1, maxb: 0, umaxbof: 1, iplay: false };
    const preBv = buildBetValue({ market: pre, section: pre.section[0], betType: 'back', odds: 1.98, match, sid: 4 });
    const base = { bv: preBv, stake: 500, odds: 1.98, originalOdds: 1.98, match, markets: [pre], signedIn: true };
    expect(prevalidateBet(base)).toEqual({ code: 'GAME_NOT_ACTIVE_2', message: 'Game Not Active2.' });
    const raceBv = buildBetValue({ market: pre, section: pre.section[0], betType: 'back', odds: 1.98, match, sid: 10 });
    expect(prevalidateBet({ ...base, bv: raceBv }).message).toBe('Check Maximum Bet Limit.');
  });

  it('stakeLimits: ₹100 floor or a higher feed min, meter keeps its own min, 0 max means 100000', () => {
    expect(stakeLimits({ min: 0, max: 2000, gtype: 'match' })).toEqual({ min: 100, max: 2000 });
    expect(stakeLimits({ min: 500, max: 0, gtype: 'fancy' })).toEqual({ min: 500, max: 100000 });
    expect(stakeLimits({ min: 10, max: 2000, gtype: 'meter' })).toEqual({ min: 10, max: 2000 });
    expect(stakeLimits({ min: 10, max: 100000, gtype: 'oddeven' })).toEqual({ min: 100, max: 100000 });
    expect(stakeLimits({ min: 100, max: 5000, is_cashout: true }).min).toBe(0);
  });

  it('buildPlaceRequest carries the mssports contract + server_buffer', () => {
    const { payload, clientRef } = buildPlaceRequest({ bv, odds: 1.98, stake: 100 });
    expect(payload).toMatchObject({
      market_type: 'MATCH_ODDS', game_type: 'MATCH', category: '0',
      eventid: '640154297', event_id: 640154297, match_id: '6637445342984', market_id: 6637445342984,
      selection_id: 11, sport_id: '4', sid: '4', sports: 'Cricket', odds_format: 'decimal',
      odds: 1.98, stake_amount: 100, bet_type: 'back', selection_name: 'Afghanistan',
      runners: ['Afghanistan', 'Bangladesh'], settlened: 'pending', unmatched: false, is_cashout: false,
    });
    expect(typeof payload.section).toBe('string');
    expect(payload.runner_odds).toEqual([{ odds: 1.98, oname: 'back1' }, { odds: 2.0, oname: 'lay1' }]);
    expect(payload.server_buffer).toMatchObject({ client_ref: clientRef, selected_odds: 1.98, edited: false, live_tracked: true, max_stake: 2000 });
  });
});

import { describe, it, expect } from 'vitest';
import { slipFigures, projectedBook, moneyNeeded } from './useMatchSlip';
import { formatBook } from '../../../components/exchange/utils';

describe('slipFigures — session fancy: TENEXCH profit 0 on Normal, liability on the rate', () => {
  const slip = (betType, size, mname = 'Normal') => ({ kind: 'runner', bv: { betType, size, gtype: 'fancy', mname } });
  it('Normal YES 55 @ 100, ₹100 → profit 0 (TENEXCH), liability ₹100', () => {
    expect(slipFigures(slip('yes', 100), 100, 55)).toEqual({ profit: 0, liability: 100 });
  });
  it('Normal NO 55 @ 90, ₹100 → profit 0, liability ₹90', () => {
    expect(slipFigures(slip('no', 90), 100, 55)).toEqual({ profit: 0, liability: 90 });
  });
  it('a fancy market not in the zero list still pays on the rate', () => {
    expect(slipFigures(slip('yes', 120, 'Wicket Lost'), 100, 3)).toEqual({ profit: 120, liability: 100 });
  });
});

describe('slipFigures — TENEXCH calcPL on runner markets', () => {
  const slip = (betType, gtype, mname, sid = '4') => ({ kind: 'runner', bv: { betType, gtype, mname, sid } });
  it('Match Odds LAY 1000 @ 2.5 → profit 1000 (the stake), liability 1500', () => {
    expect(slipFigures(slip('lay', 'match', 'MATCH_ODDS'), 1000, 2.5)).toEqual({ profit: 1000, liability: 1500 });
  });
  it('Match Odds BACK 1000 @ 2.5 → profit 1500, liability 1000', () => {
    expect(slipFigures(slip('back', 'match', 'MATCH_ODDS'), 1000, 2.5)).toEqual({ profit: 1500, liability: 1000 });
  });
  it('any match1 market prices as a percent (Bookmaker, and a named one)', () => {
    expect(slipFigures(slip('back', 'match1', 'Bookmaker'), 100, 57)).toEqual({ profit: 57, liability: 100 });
    expect(slipFigures(slip('lay', 'match1', 'Score More Runs 1st Inn'), 100, 13)).toEqual({ profit: 100, liability: 13 });
  });
  it('a horse racecard prints profit 0 (TENEXCH horse slip); greyhound computes it', () => {
    expect(slipFigures(slip('back', 'match', 'MATCH_ODDS', '10'), 100, 5).profit).toBe(0);
    expect(slipFigures(slip('back', 'match', 'MATCH_ODDS', '65'), 100, 5).profit).toBe(400);
  });
});

describe('projectedBook — TENEXCH runnerPL on every MATCH_ODDS / BOOKMAKER / CRICKET_CASINO market', () => {
  const section = [{ nat: 'A' }, { nat: 'B' }, { nat: 'C' }];
  const slip = (gtype, betType = 'back') => ({ kind: 'runner', bv: { market_id: 1, betType, runnerName: 'A', gtype } });
  it('Over/Under (gtype match) back 100 @ 2.5 adds to the existing book', () => {
    const market = { mid: 1, gtype: 'match', mname: 'OVER_UNDER_25', section };
    expect(projectedBook(slip('match'), 100, 2.5, market, { '1:a': 20 })).toEqual({ A: 170, B: -100, C: -100 });
  });
  it('Bookmaker lay 100 @ 40 is a percent', () => {
    const market = { mid: 1, gtype: 'match1', mname: 'Bookmaker', section };
    expect(projectedBook(slip('match1', 'lay'), 100, 40, market, {})).toEqual({ A: -40, B: 100, C: 100 });
  });
  it('cricket casino grid books too; a fancy never', () => {
    expect(projectedBook(slip('cricketcasino'), 100, 9.5, { mid: 1, gtype: 'cricketcasino', section }, {}).A).toBe(850);
    expect(projectedBook(slip('fancy'), 100, 55, { mid: 1, gtype: 'fancy', section }, {})).toBeNull();
  });
});

describe('formatBook — TENEXCH book text', () => {
  it('no "+", no ".00", en-IN grouping from 1,000', () => {
    expect(formatBook(-11)).toBe('-11');
    expect(formatBook(20)).toBe('20');
    expect(formatBook(4500)).toBe('4,500');
    expect(formatBook(200000)).toBe('2,00,000');
    expect(formatBook(-120.5)).toBe('-120.5');
    expect(formatBook(0)).toBe('0');
  });
});

describe('moneyNeeded — TENEXCH Step 0a wallet gate', () => {
  const market = { mid: 'm1', gtype: 'match', mname: 'MATCH_ODDS', section: [{ nat: 'A' }, { nat: 'B' }] };
  const slip = (betType) => ({ bv: { market_id: 'm1', betType, runnerName: 'A', gtype: 'match', mname: 'MATCH_ODDS' } });
  it('a fresh back needs its stake', () => {
    expect(moneyNeeded(slip('back'), 100, 1.32, market, {})).toBe(100);
  });
  it('a fresh lay needs its liability', () => {
    expect(moneyNeeded(slip('lay'), 100, 1.5, market, {})).toBe(50);
  });
  it('a lay that hedges an existing back needs less than its stake', () => {
    // existing book: A +32, B -100 (back A 100 @ 1.32); lay A 100 @ 1.33 → A -1, B 0 → worst 1, before 100
    const book = { 'm1:a': 32, 'm1:b': -100 };
    expect(moneyNeeded(slip('lay'), 100, 1.33, market, book)).toBeLessThanOrEqual(0);
  });
  it('a fancy (no runner book) needs the stake', () => {
    const fancy = { mid: 'f1', gtype: 'fancy', mname: 'Normal', section: [{ nat: '6 over run' }] };
    const s = { bv: { market_id: 'f1', betType: 'no', runnerName: '6 over run', gtype: 'fancy', mname: 'Normal' } };
    expect(moneyNeeded(s, 100, 73, fancy, {})).toBe(100);
  });
});

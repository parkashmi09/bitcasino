// Pure-rule tests for the bet-placement layer.
//
// Why these exist: every new market scenario used to arrive as another `if`
// inside usePlaceBetPanel (858 lines, 97 branches) with nothing but a browser
// click to prove it. These lock the DECISIONS down so the pipeline can be
// refactored without changing behaviour.
//
// Values are taken from real feed payloads observed on 2026-09-12 (noted per
// test), not invented.

import { describe, it, expect } from 'vitest';
import {
  isRaceBettingOpen,
  parseFeedIstTime,
  BET_ERROR,
  getBetValidationError,
  MIN_BET_AMOUNT,
  VIRTUAL_MIN_BET_AMOUNT,
  MARKET_FAMILY,
  getMarketFamily,
  normalizeMarketKey,
  hasRunnerBook,
  ODDS_FIELD,
  getOddsFieldMode,
  isBookmakerStyle,
  isOddsLockedByType,
  isBlockedGameStatus,
  suspensionToastMessage,
  isLaySide,
  isAllBackMarket,
  showsAsLay,
  isOddEvenGtype,
  panelSideClass,
  showsZeroProfit,
  feedSideFor,
  exposureItemMatchesMarket,
  isCricketLimitedOvers,
  maxOddsBlockScope,
  stepOdds,
  namesOwnLine,
  calcPL,
  calcProfit,
} from './placeBetRules';
import { BET_TOAST } from './betToastMessages';

describe('getBetValidationError', () => {
  const ok = { stakeNum: 500, minStake: 100, maxStake: 50000, suspended: false, isValid: true };

  it('accepts a normal stake inside the market limits', () => {
    expect(getBetValidationError(ok)).toBeNull();
  });

  it('reports an empty stake first, before any other problem', () => {
    // A suspended market with no stake typed must still say "enter a stake".
    expect(getBetValidationError({ ...ok, stakeNum: 0, suspended: true })).toBe(BET_ERROR.EMPTY_STAKE);
  });

  it('separates the two absurd-amount bands (16+ zeros vs 12-15)', () => {
    expect(getBetValidationError({ ...ok, stakeNum: 1e16 })).toBe(BET_ERROR.ABSURD_SERVER);
    expect(getBetValidationError({ ...ok, stakeNum: 1e12 })).toBe(BET_ERROR.ABSURD_INVALID);
    // Just below the band is an ordinary above-max rejection, not "not valid".
    expect(getBetValidationError({ ...ok, stakeNum: 1e12 - 1 })).toBe(BET_ERROR.ABOVE_MAX);
  });

  it('checks min and max only when the market states them', () => {
    expect(getBetValidationError({ ...ok, stakeNum: 99 })).toBe(BET_ERROR.BELOW_MIN);
    expect(getBetValidationError({ ...ok, stakeNum: 50001 })).toBe(BET_ERROR.ABOVE_MAX);
    // Line Market ships min 0 / max 0 — neither bound applies.
    expect(getBetValidationError({ ...ok, stakeNum: 5, minStake: 0, maxStake: 0 })).toBeNull();
  });

  it('rejects a suspended market, then anything else invalid', () => {
    expect(getBetValidationError({ ...ok, suspended: true })).toBe(BET_ERROR.SUSPENDED);
    expect(getBetValidationError({ ...ok, isValid: false })).toBe(BET_ERROR.INVALID);
  });

  it('keeps the two bet floors apart', () => {
    expect(MIN_BET_AMOUNT).toBe(100); // TENEXCH (Addaplay had 50) — user's call 2026-10-21
    expect(VIRTUAL_MIN_BET_AMOUNT).toBe(200);
  });
});

describe('market family', () => {
  it('collapses the three spellings of one market onto the same family', () => {
    // Our label, the feed's mname and the exposure row's game_type.
    expect(getMarketFamily('MATCH_ODDS')).toBe(MARKET_FAMILY.MATCH_ODDS);
    expect(getMarketFamily('Bookmaker')).toBe(MARKET_FAMILY.BOOKMAKER);
    expect(getMarketFamily('Bookmaker 2')).toBe(MARKET_FAMILY.BOOKMAKER);
    expect(getMarketFamily('Tied Match')).toBe(MARKET_FAMILY.TIED_MATCH);
    expect(normalizeMarketKey('Bookmaker 2')).toBe('BOOKMAKER2');
  });

  it('treats fancy and friends as OTHER, with no runner book', () => {
    for (const t of ['Normal', 'fancy1', 'oddeven', 'khado', 'meter', 'fancy2']) {
      expect(getMarketFamily(t)).toBe(MARKET_FAMILY.OTHER);
      expect(hasRunnerBook(t)).toBe(false);
    }
    expect(hasRunnerBook('MATCH_ODDS')).toBe(true);
  });

  it('filters exposure rows by family for MO/BM and lets everything else through', () => {
    expect(exposureItemMatchesMarket('Bookmaker', 'MATCH_ODDS')).toBe(false);
    expect(exposureItemMatchesMarket('MATCH_ODDS', 'MATCH_ODDS')).toBe(true);
    expect(exposureItemMatchesMarket('anything', 'Normal')).toBe(true);
  });
});

describe('slip odds field', () => {
  it('shows a plain span for fancy and every bookmaker spelling', () => {
    expect(getOddsFieldMode('fancy', 'Normal')).toBe(ODDS_FIELD.TEXT);
    expect(getOddsFieldMode('match1', 'Bookmaker')).toBe(ODDS_FIELD.TEXT);
    // A "Bookmaker"-named market can still arrive as gtype match.
    expect(getOddsFieldMode('match', 'Bookmaker')).toBe(ODDS_FIELD.TEXT);
    expect(getOddsFieldMode('match', 'BM 2nd Set Winner')).toBe(ODDS_FIELD.TEXT);
    // Odd/Even too: the live reference prints `1.96` straight on the blue
    // panel, where we used to draw a white readonly input.
    expect(getOddsFieldMode('oddeven', 'oddeven')).toBe(ODDS_FIELD.TEXT);
    // Cricket-casino Number grid, same reason (live "0 Number" @ 9.5).
    expect(getOddsFieldMode('cricketcasino', '2ND INN 6 OVER GAW VS TKR')).toBe(ODDS_FIELD.TEXT);
  });

  it('gives Match Odds the -/+ stepper and leaves the rest read-only', () => {
    expect(getOddsFieldMode('match', 'MATCH_ODDS')).toBe(ODDS_FIELD.STEPPER);
    // Khado shows the stepper shape as well — the reference picks the `− input +`
    // trio for gtype khado / match / fancy2 (racing etid 65 excepted).
    expect(getOddsFieldMode('khado', 'khado')).toBe(ODDS_FIELD.READONLY);
    // Line markets joined the stepper with khado and match — the same
    // reference rule lists all three.
    expect(getOddsFieldMode('fancy2', '20 Overs Line')).toBe(ODDS_FIELD.STEPPER);
    // oddeven and cricketcasino left this list on 2026-09-12 — both print bare
    // text, see above.
    for (const gtype of ['fancy1', 'meter']) {
      expect(getOddsFieldMode(gtype, gtype)).toBe(ODDS_FIELD.READONLY);
    }
    /* Racing is pulled out of the stepper even though its MATCH_ODDS is gtype
       'match' — the reference rule ends `|| 65==etid`. BOTH codes: horse
       (RacingDetails) and greyhound (Market13Block). */
    expect(getOddsFieldMode('match', 'MATCH_ODDS', { isRacing: true })).toBe(ODDS_FIELD.TEXT);
  });

  it('locks the odds for the fancy family only', () => {
    expect(isOddsLockedByType('normal', '')).toBe(true);
    expect(isOddsLockedByType('', 'oddeven')).toBe(true);
    expect(isOddsLockedByType('MATCH_ODDS', 'MATCH_ODDS')).toBe(false);
    expect(isBookmakerStyle('match1', '')).toBe(true);
    expect(isBookmakerStyle('match', 'MATCH_ODDS')).toBe(false);
  });
});

describe('live game status', () => {
  it('blocks exactly the three feed statuses', () => {
    expect(isBlockedGameStatus('SUSPENDED')).toBe(true);
    expect(isBlockedGameStatus('BALL RUNNING')).toBe(true);
    expect(isBlockedGameStatus('INACTIVE')).toBe(true);
    expect(isBlockedGameStatus('ACTIVE')).toBe(false);
    expect(isBlockedGameStatus('OPEN')).toBe(false);
    expect(isBlockedGameStatus('')).toBe(false);
  });

  it('uses the Ball Running toast only for Ball Running', () => {
    expect(suspensionToastMessage('BALL RUNNING')).toBe(BET_TOAST.BALL_RUNNING);
    expect(suspensionToastMessage('SUSPENDED')).toBe(BET_TOAST.GAME_NOT_ACTIVE);
    // Pin the WORDING, not just the key: the two assertions above pass for any
    // string, so a revert of the 2026-09-12 change would go unnoticed. Badlo
    // shares it. Note the live reference reads "…game suspense." — shipping
    // "suspend." is the user's deliberate call, which is exactly why it is
    // pinned here.
    expect(BET_TOAST.GAME_NOT_ACTIVE).toBe('Bet Not Confirmed due to game suspend.');
    expect(BET_TOAST.BADLO_GAME_SUSPENSE).toBe(BET_TOAST.GAME_NOT_ACTIVE);
    // BALL RUNNING keeps its own, different toast.
    expect(BET_TOAST.BALL_RUNNING).toBe('Ball Running');
  });
});

describe('showsZeroProfit', () => {
  it('prints a fixed 0 for the session markets whose slip never computes one', () => {
    for (const m of ['Normal', 'Ball By Ball', 'Over By Over']) {
      expect(showsZeroProfit(m, '')).toBe(true);
    }
    /* khado LEFT this list on 2026-09-13: its slip shows a real figure, priced
       off the run line, so it moves as the − / + step it. */
    expect(showsZeroProfit('khado', '')).toBe(false);
    expect(showsZeroProfit('', 'khado')).toBe(false);
    /* HORSE racing joined it — the reference has a separate horse slip whose
       Profit is the literal string "0", never computed. Greyhound does NOT: it
       runs on the normal slip (GameDetails / Market13Block) and computes one. */
    expect(showsZeroProfit('MATCH_ODDS', '', 'match', { isHorseRacing: true })).toBe(true);
    expect(showsZeroProfit('MATCH_ODDS', '', 'match', { isRacing: true })).toBe(false);
    expect(showsZeroProfit('MATCH_ODDS', '', 'match')).toBe(false);
  });

  it('leaves every other slip computing its own profit', () => {
    for (const m of ['MATCH_ODDS', 'Bookmaker', 'Tied Match', 'fancy1', 'oddeven', 'meter', 'cricketcasino']) {
      expect(showsZeroProfit(m, '')).toBe(false);
    }
    expect(showsZeroProfit('', '')).toBe(false);
  });
});

describe('sides', () => {
  it("paints Odd/Even's second leg as a back, though it is stored as 'no'", () => {
    expect(isLaySide('no')).toBe(true);            // exposure/settlement still read it as a lay
    expect(isAllBackMarket('oddeven')).toBe(true);
    expect(showsAsLay('no', 'oddeven')).toBe(false); // display only
    expect(showsAsLay('no', 'Normal')).toBe(true);
  });

  it('gives the Odd/Even slip a blue panel on BOTH legs, keyed on gtype', () => {
    // Live oddeven market (gmid 500320709, mid 500119625745): gtype 'oddeven',
    // Even cell clicked → bet_type 'no'. Reference slip is `place-bet back`.
    expect(isOddEvenGtype('oddeven')).toBe(true);
    expect(panelSideClass('no', 'oddeven')).toBe('back');
    expect(panelSideClass('yes', 'oddeven')).toBe('back');
    // OddEvenBlock hands the slip marketType 'FANCY' for that very same row,
    // which is exactly why the colour cannot be keyed on the market type.
    expect(isOddEvenGtype('FANCY')).toBe(false);
  });

  it('leaves every other gtype on the ordinary back/lay rule', () => {
    for (const gtype of ['match', 'match1', 'fancy', 'fancy1', 'fancy2', 'khado',
                         'meter', 'cricketcasino', 'badlo', '', null, undefined]) {
      expect(panelSideClass('lay', gtype)).toBe('lay');
      expect(panelSideClass('no', gtype)).toBe('lay');
      expect(panelSideClass('back', gtype)).toBe('back');
      expect(panelSideClass('yes', gtype)).toBe('back');
    }
  });

  it('inverts the feed side for line markets', () => {
    expect(feedSideFor('no', false)).toBe('lay');
    expect(feedSideFor('no', true)).toBe('back');
    expect(feedSideFor('back', true)).toBe('lay');
  });
});

describe('owner max-odds rule', () => {
  const rule = { max: 4, sport: 'Cricket', limitedOversOnly: true };

  it('detects limited-overs cricket from the competition name, exempting Tests', () => {
    expect(isCricketLimitedOvers({ sid: '4', cname: 'Caribbean Premier League', ename: 'GAW v TKR' })).toBe(true);
    expect(isCricketLimitedOvers({ sid: '4', cname: 'Test Matches', ename: 'WI v PAK' })).toBe(false);
    expect(isCricketLimitedOvers({ sid: '1', cname: 'Serie A', ename: 'x v y' })).toBe(false);
  });

  it('blocks only above the cap, and only in the rule’s scope', () => {
    expect(maxOddsBlockScope({ rule, odds: 4.5, limitedOvers: true })).toBe(BET_TOAST.LIMITED_OVERS_SCOPE);
    expect(maxOddsBlockScope({ rule, odds: 4, limitedOvers: true })).toBeNull();   // at the cap is allowed
    expect(maxOddsBlockScope({ rule, odds: 4.5, limitedOvers: false })).toBeNull(); // Test match
    expect(maxOddsBlockScope({ rule: null, odds: 999, limitedOvers: true })).toBeNull();
  });

  it('names the sport when the rule is not limited-overs-only', () => {
    expect(maxOddsBlockScope({ rule: { max: 10, sport: 'Football' }, odds: 11, limitedOvers: false })).toBe('Football');
  });
});

describe('odds ladder', () => {
  it('steps by the band the price sits in', () => {
    expect(stepOdds('1.50', 1)).toBe('1.51');   // 1-2 band: 0.01
    expect(stepOdds('2.50', 1)).toBe('2.52');   // 2-3 band: 0.02
    expect(stepOdds('11', 1)).toBe('11.5');     // 10-20 band: 0.5
  });

  it('never leaves the 1.01-1000 range and never pads decimals', () => {
    expect(stepOdds('1.01', -1)).toBe('1.01');
    expect(stepOdds('1000', 1)).toBe('1000');
    expect(stepOdds('38', 1)).toBe('40');       // 30-50 band: 2, and "40" not "40.00"
  });
});

describe('profit / loss', () => {
  it('prices a decimal-odds back and lay off (odds - 1)', () => {
    expect(calcProfit(100, 2.5, 'back', 'MATCH_ODDS')).toBe(150);
    expect(calcPL(100, 2.5, 'lay', 'MATCH_ODDS')).toEqual({ profit: 100, loss: 150 });
  });

  it('prices bookmaker rates per 100 — the real GAW v TKR bookmaker', () => {
    // Observed 2026-09-12: Bookmaker back1 769 on Namibia, stake 100 → +769.
    expect(calcProfit(100, 769, 'back', 'BOOKMAKER')).toBe(769);
  });
});

describe('namesOwnLine', () => {
  it('is khado only — a line-market field is a quoted price, not a named line', () => {
    expect(namesOwnLine('khado', 'khado', '')).toBe(true);
    expect(namesOwnLine('', 'khado', '')).toBe(true);
    expect(namesOwnLine('', '', 'khado')).toBe(true);
    // Line markets left on 2026-09-14 (user: a stepped line must still fall on
    // the main odds), so the slip places them at `betOdds` like a depth cell.
    // The dtype argument used to admit them too — it must not any more.
    expect(namesOwnLine('fancy2', 'fancy2', '1st Innings 20 Overs Line')).toBe(false);
    expect(namesOwnLine('fancy2', 'fancy2', '1st Innings 20 Overs Line', 14)).toBe(false);
    expect(namesOwnLine('', '', '', 14)).toBe(false);
    for (const t of ['Normal', 'fancy1', 'oddeven', 'meter', 'match', 'match1']) {
      expect(namesOwnLine(t, t, t)).toBe(false);
    }
  });
});

describe('racing betting window', () => {
  // 10/17/2026 12:40:00 PM IST = 07:10:00 UTC
  const start = Date.UTC(2026, 9, 17, 7, 10, 0);
  it('reads the feed time as IST', () => {
    expect(parseFeedIstTime('10/17/2026 12:40:00 PM')).toBe(start);
  });
  it('refuses a horse bet more than 5 minutes before the off; greyhound stays open (TENEXCH server)', () => {
    expect(isRaceBettingOpen(10, '10/17/2026 12:40:00 PM', start - 6 * 60000)).toBe(false);
    expect(isRaceBettingOpen('65', '10/17/2026 12:40:00 PM', start - 131 * 60000)).toBe(true);
  });
  it('accepts inside the last 5 minutes and after the off', () => {
    expect(isRaceBettingOpen(10, '10/17/2026 12:40:00 PM', start - 4 * 60000)).toBe(true);
    expect(isRaceBettingOpen(10, '10/17/2026 12:40:00 PM', start + 60000)).toBe(true);
  });
  it('never limits other sports, and fails open on an unreadable time', () => {
    expect(isRaceBettingOpen(4, '10/17/2026 12:40:00 PM', start - 60 * 60000)).toBe(true);
    expect(isRaceBettingOpen(10, 'soon', start)).toBe(true);
  });
});

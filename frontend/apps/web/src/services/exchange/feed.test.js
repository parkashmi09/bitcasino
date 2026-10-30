import { describe, expect, it } from 'vitest';
import { readPushedMarkets } from './feed';

/* The pushed reply ({status, body} of the REST route) reads exactly as the HTTP answer would. */
describe('readPushedMarkets', () => {
  const market = { mid: 1, mname: 'MATCH_ODDS' };

  it('200 with markets → ok, the provider wrapper unwrapped', () => {
    expect(readPushedMarkets(200, { success: true, data: { success: true, data: [market] } })).toEqual({ state: 'ok', markets: [market] });
  });

  it('between rounds → no_record; provider 404 inside a 200 → gone', () => {
    expect(readPushedMarkets(200, { success: true, data: { success: false, status: 300, msg: 'No Record Found.' } }).state).toBe('no_record');
    expect(readPushedMarkets(200, { success: true, data: { success: false, status: 404 } }).state).toBe('gone');
  });

  it('404 (hidden sport) → gone; a 500 says nothing about the match and throws', () => {
    expect(readPushedMarkets(404, { success: false, error: 'This sport is not available' }).state).toBe('gone');
    expect(readPushedMarkets(500, { success: false, error: 'Request failed with status code 404' }).state).toBe('gone');
    expect(() => readPushedMarkets(500, { success: false, error: 'timeout of 8000ms exceeded' })).toThrow('timeout');
  });
});

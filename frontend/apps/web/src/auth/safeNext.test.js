import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext';

describe('safeNext', () => {
  it('keeps a same-origin path, with its query and hash', () => {
    expect(safeNext('/profile/account?tab=1')).toBe('/profile/account?tab=1');
    expect(safeNext({ pathname: '/vip', search: '?x=1', hash: '#top' })).toBe('/vip?x=1#top');
  });

  it('refuses anything that could leave the site', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/\tx', 'vip', '', null, undefined, {}]) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { cleanBranding, withBrand } from './branding';

const ASSET = `/api/v1/admin/branding/asset/${'a'.repeat(64)}.png`;

describe('cleanBranding', () => {
  it('is null for an unbranded site or one with no name', () => {
    expect(cleanBranding({ branded: false, siteName: 'X' })).toBeNull();
    expect(cleanBranding({ branded: true, siteName: '' })).toBeNull();
  });

  it('keeps asset URLs of the asset route only and drops unsafe text', () => {
    const b = cleanBranding({
      branded: true,
      siteName: 'TestPlay',
      title: '<script>',
      logoUrl: ASSET,
      markUrl: 'https://evil.example/x.png',
      themeColor: '#232626',
      keywords: ['casino', '<b>'],
    });
    expect(b).toMatchObject({ siteName: 'TestPlay', title: null, logoUrl: ASSET, markUrl: null, themeColor: '#232626', keywords: ['casino'] });
  });
});

describe('withBrand', () => {
  it('renames copy through nested data but leaves links and paths alone', () => {
    const data = {
      title: 'League of Bitcasino',
      rows: [['BitCasino AML policy', '/help-center/aml']],
      image: 'https://cdn.example.com/1A%20Bitcasino/a.jpg',
      count: 3,
    };
    expect(withBrand(data, 'TestPlay')).toEqual({
      title: 'League of TestPlay',
      rows: [['TestPlay AML policy', '/help-center/aml']],
      image: 'https://cdn.example.com/1A%20Bitcasino/a.jpg',
      count: 3,
    });
  });
});

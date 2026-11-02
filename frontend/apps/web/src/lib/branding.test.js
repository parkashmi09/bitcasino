import { describe, expect, it } from 'vitest';
import { applyBranding, cleanBranding, pageNameFor, withBrand } from './branding';

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

describe('title template', () => {
  it('names pages by their most specific prefix, and not the home page', () => {
    expect(pageNameFor('/promotions/weekly-rakeback')).toBe('Promotions');
    expect(pageNameFor('/games/favourite')).toBe('Favourites');
    expect(pageNameFor('/games/new')).toBe('Games');
    expect(pageNameFor('/')).toBe(null);
  });

  it('fills the template with the page name, else uses the plain title', () => {
    const branding = { siteName: 'Bitcasino', title: 'Bitcasino — Crypto Casino', titleTemplate: '%s · Bitcasino', keywords: [] };
    applyBranding(branding, 'Promotions');
    expect(document.title).toBe('Promotions · Bitcasino');
    applyBranding(branding, null);
    expect(document.title).toBe('Bitcasino — Crypto Casino');
    applyBranding({ ...branding, titleTemplate: null }, 'Promotions');
    expect(document.title).toBe('Bitcasino — Crypto Casino');
  });
});

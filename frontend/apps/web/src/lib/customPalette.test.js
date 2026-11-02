import { describe, expect, it } from 'vitest';
import { applyCustomPalette } from './customPalette';

describe('applyCustomPalette', () => {
  it('maps an owner theme onto the Moon tokens and cleans up', () => {
    const style = document.documentElement.style;
    const off = applyCustomPalette({ accent: 'ff0000', onAccent: '000000', bg: '101010', card: '202020' });
    expect(style.getPropertyValue('--piccolo')).toBe('255 0 0');
    expect(style.getPropertyValue('--piccolo-80')).toBe('255 51 51');
    expect(style.getPropertyValue('--jiren')).toBe('255 0 0 / 0.12');
    expect(style.getPropertyValue('--goku')).toBe('16 16 16');
    expect(style.getPropertyValue('--gohan')).toBe('32 32 32');
    expect(style.getPropertyValue('--beerus')).toBe('');
    off();
    expect(style.getPropertyValue('--piccolo')).toBe('');
  });

  it('ignores a missing or malformed theme', () => {
    expect(applyCustomPalette(undefined)).toBeUndefined();
    expect(applyCustomPalette({ accent: '#ff0000' })).toBeUndefined();
  });
});

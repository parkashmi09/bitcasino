import { describe, expect, it } from 'vitest';
import { cleanPhone, isValidPhone } from './phone';

describe('phone', () => {
  it('cleans and checks the way the platform does', () => {
    expect(cleanPhone(' +91 98765-43210 ')).toBe('+919876543210');
    expect(isValidPhone('+91 (98765) 43.210')).toBe(true);
    expect(isValidPhone('447700900000')).toBe(true);
    expect(isValidPhone('+12345678')).toBe(false);
    expect(isValidPhone('+1234567890123456')).toBe(false);
    expect(isValidPhone('+44 77OO 900000')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});

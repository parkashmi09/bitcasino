import { describe, expect, it } from 'vitest';
import { toInboxItem } from './notifications';
import { paidMessage } from './promotions';

describe('toInboxItem', () => {
  it('keeps the bigint id as a string and reads the server read flag', () => {
    const item = toInboxItem({ id: '9007199254740993', title: 'Deposit approved', body: '100 INR', read: false, createdAt: '2026-10-27T10:00:00Z' });
    expect(item).toEqual({
      id: 'n:9007199254740993',
      serverId: '9007199254740993',
      title: 'Deposit approved',
      body: '100 INR',
      at: '2026-10-27T10:00:00Z',
      read: false,
    });
  });

  it('survives a row with nothing in it', () => {
    expect(toInboxItem({ id: 1 })).toMatchObject({ title: '', body: '', at: null, read: false });
  });
});

describe('paidMessage', () => {
  it('reads a race claim (amount) and an affiliate claim-all (total)', () => {
    expect(paidMessage({ amount: '12.5', currency: 'USDT' })).toBe('12.50 USDT added to your balance.');
    expect(paidMessage({ total: '3', currency: 'INR' })).toBe('3.00 INR added to your balance.');
  });
});

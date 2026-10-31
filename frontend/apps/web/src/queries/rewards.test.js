import { describe, expect, it } from 'vitest';
import { toDepositOffer, toTiers } from './rewards';

describe('toTiers', () => {
  // The live ladder's shape, cut down: unranked, then bands grouped by `card`.
  const ladder = {
    unranked: { level: 0, name: 'Beginner', card: 'unranked' },
    levels: [
      { level: 1, name: 'Bronze I', minXp: '1000', maxXp: '2999', card: 'bronze' },
      { level: 2, name: 'Bronze II', minXp: '3000', maxXp: '6999', card: 'bronze' },
      { level: 3, name: 'Silver I', minXp: '7000', maxXp: null, card: 'silver' },
    ],
  };

  it('groups bands by card, unranked first, open-ended top', () => {
    expect(toTiers(ladder).map(({ art, ...tier }) => tier)).toEqual([
      { card: 'unranked', name: 'Beginner', points: '0 - 999', levels: 1 },
      { card: 'bronze', name: 'Bronze', points: '1000 - 6999', levels: 2 },
      { card: 'silver', name: 'Silver', points: '7000 - ...', levels: 1 },
    ]);
  });

  it('keeps the Loyalty Club ladder one tier per level, with multiplier and milestones', () => {
    const loyalty = {
      unranked: { level: 0, name: 'Beginner', card: 'beginner', multiplier: '1' },
      levels: [
        { level: 1, name: 'Fan', minXp: '5', maxXp: '3749', card: 'fan', multiplier: '1', milestones: '1' },
        { level: 2, name: 'Hero', minXp: '3750', maxXp: null, card: 'hero', multiplier: '3', milestones: 'unlimited' },
      ],
    };
    expect(toTiers(loyalty).map(({ name, points, multiplier, milestones }) => [name, points, multiplier, milestones])).toEqual([
      ['Beginner', '0 - 4', '1', undefined],
      ['Fan', '5 - 3749', '1', '1'],
      ['Hero', '3750 - ...', '3', 'unlimited'],
    ]);
  });

  it('answers an empty list for no ladder', () => {
    expect(toTiers(undefined)).toEqual([]);
  });
});

describe('toDepositOffer', () => {
  const terms = {
    enabled: true,
    eligible: true,
    currency: 'INR',
    tiers: [
      { minDeposit: '100.00', percent: 50, maxBonus: '500.00' },
      { minDeposit: '10.00', percent: 100, maxBonus: '0.00' },
    ],
    wagerMultiplier: null,
    expiryDays: 30,
    wageringLock: true,
    program: { mode: 'first', schedule: [{ percent: 180, minDeposit: '5.00' }], usedThisMonth: null },
  };

  it('is null for a player who cannot get it', () => {
    expect(toDepositOffer({ ...terms, eligible: false })).toBeNull();
    expect(toDepositOffer({ ...terms, enabled: false })).toBeNull();
  });

  it('offers every first-deposit tier, top percent in the title, no cap as null', () => {
    const offer = toDepositOffer(terms);
    expect(offer.title).toBe('First deposit bonus – up to 100%');
    expect(offer.minDeposit).toBe('10.00');
    expect(offer.tiers[1]).toEqual({ minDeposit: '10.00', percent: 100, maxBonus: null });
    expect(offer.expiryDays).toBe(30);
  });

  it('offers only this month\'s next step on a monthly program', () => {
    const offer = toDepositOffer({
      ...terms,
      program: { mode: 'monthly', usedThisMonth: 1, schedule: [{ percent: 180, minDeposit: '5.00' }, { percent: 240, minDeposit: '10.00' }] },
    });
    expect(offer.title).toBe('Deposit bonus – 240%');
    expect(offer.tiers).toHaveLength(1);
  });
});

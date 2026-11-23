import { describe, expect, it } from 'vitest';
import { makeGates } from '@/lib/gates';
import { cashierTabs, depositError, payoutError, shownRail, walletCoins } from './cashier';

const AGENT_CAPS = { promotions: false, vault: false, deposit: false, swap: false, withdraw: false };
const policy = (key, variant) => ({ feature: key, kind: 'policy', variant });

describe('cashierTabs', () => {
  it('offers everything when nothing is switched off', () => {
    expect(cashierTabs(makeGates())).toEqual(['deposit', 'withdraw', 'swap', 'vault']);
  });

  it('keeps Deposit (the manual transfer) on a manual-only site, drops the owner-plan sections', () => {
    const gates = makeGates({ features: [policy('deposit_mode', 'manual')] });
    expect(gates.autoDeposit()).toBe(false);
    expect(cashierTabs(gates)).toEqual(['deposit', 'withdraw']);
  });

  it('drops Deposit on a manual-only site whose admin switched manual deposits off', () => {
    const gates = makeGates({ features: [policy('deposit_mode', 'manual')], capabilities: { manualDeposit: false } });
    expect(cashierTabs(gates)).toEqual(['withdraw']);
  });

  it('keeps Withdraw for a withdraw-locked player, not for other refusals', () => {
    const gates = makeGates({ capabilities: { withdraw: false } });
    expect(cashierTabs(gates, true)).toContain('withdraw');
    expect(cashierTabs(gates, false)).not.toContain('withdraw');
  });

  it('leaves an agent player nothing to open', () => {
    expect(cashierTabs(makeGates({ capabilities: AGENT_CAPS }), true)).toEqual([]);
  });
});

describe('walletCoins', () => {
  const flag = (key) => key !== 'btc';

  it('follows the site flags until the balances answer, then the balances', () => {
    expect(walletCoins({ status: 'loading', flag })).not.toContain('BTC');
    expect(walletCoins({ status: 'ready', balances: { USDT: '1', INR: '0' }, flag })).toEqual(['USDT', 'INR']);
  });

  it('shows an agent player INR only', () => {
    expect(walletCoins({ status: 'loading', flag, agentPlayer: true })).toEqual(['INR']);
  });
});

describe('withdraw rails', () => {
  it('shows the pick when both are open, the open one otherwise', () => {
    expect(shownRail({ manual: true, auto: true, picked: 'auto' })).toBe('auto');
    expect(shownRail({ manual: true, auto: false, picked: 'auto' })).toBe('manual');
    expect(shownRail({ manual: false, auto: true, picked: 'manual' })).toBe('auto');
    expect(shownRail({ manual: false, auto: false, picked: 'manual' })).toBeNull();
  });

  it('keeps an automatic-only site on the automatic rail (withdraw tab stays)', () => {
    const gates = makeGates({ features: [policy('withdrawal_mode', 'automatic')] });
    expect(cashierTabs(gates)).toContain('withdraw');
    expect(shownRail({ manual: gates.manualWithdraw(true), auto: gates.autoWithdraw(), picked: 'manual' })).toBe('auto');
  });

  it('names the field a refused payout points at', () => {
    expect(payoutError({ message: 'Invalid payout details', details: { fields: { bank_code: 'must be a valid IFSC code' } } }))
      .toBe('Invalid payout details: IFSC code must be a valid IFSC code');
    expect(payoutError({ message: 'Nope' })).toBe('Nope');
  });
});

describe('depositError', () => {
  it('says how much of the deposit limit is left', () => {
    const error = { code: 'RESPONSIBLE_DEPOSIT_LIMIT_REACHED', details: { limitUsd: '100', usedUsd: '80', depositUsd: '50' } };
    expect(depositError(error)).toBe('This goes over your deposit limit: 20.00 of 100.00 USD left.');
  });
  it('falls back to the message, then the default', () => {
    expect(depositError({ code: 'X', message: 'Nope' })).toBe('Nope');
    expect(depositError(null)).toBe('The deposit was refused.');
  });
});

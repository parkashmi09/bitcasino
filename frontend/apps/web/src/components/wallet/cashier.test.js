import { describe, expect, it } from 'vitest';
import { makeGates } from '@/lib/gates';
import { cashierTabs, walletCoins } from './cashier';

const AGENT_CAPS = { promotions: false, vault: false, deposit: false, swap: false, withdraw: false };
const policy = (key, variant) => ({ feature: key, kind: 'policy', variant });

describe('cashierTabs', () => {
  it('offers everything when nothing is switched off', () => {
    expect(cashierTabs(makeGates())).toEqual(['deposit', 'buy', 'withdraw', 'swap', 'vault']);
  });

  it('keeps Deposit (the manual transfer) on a manual-only site, drops the owner-plan sections', () => {
    const gates = makeGates({ features: [policy('deposit_mode', 'manual')] });
    expect(gates.autoDeposit()).toBe(false);
    expect(cashierTabs(gates)).toEqual(['deposit', 'buy', 'withdraw']);
  });

  it('drops Deposit on a manual-only site whose admin switched manual deposits off', () => {
    const gates = makeGates({ features: [policy('deposit_mode', 'manual')], capabilities: { manualDeposit: false } });
    expect(cashierTabs(gates)).toEqual(['buy', 'withdraw']);
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

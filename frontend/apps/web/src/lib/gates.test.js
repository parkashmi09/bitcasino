import { describe, expect, it } from 'vitest';
import { ALL_ON, gateOf, makeGates } from './gates';

const AGENT_CAPS = { promotions: false, vault: false, deposit: false, swap: false, withdraw: false, tips: false, kyc: false };

describe('gates', () => {
  it('fails open with nothing answered', () => {
    expect(ALL_ON.routeOn('/vip')).toBe(true);
    expect(ALL_ON.on('deposit')).toBe(true);
    expect(ALL_ON.canSignUp()).toBe(true);
  });

  it('maps routes to sections, most specific first', () => {
    expect(gateOf('/promotions/spin-the-wheel?x=1')).toBe('wheel');
    expect(gateOf('/promotions')).toBe('promotions');
    expect(gateOf('/profile/transactions')).toBe(null);
    // hash-shaped admin links: VIP follows vip, sports never exists here.
    expect(makeGates({ flags: { vipclub: false } }).routeOn('/vip-detail')).toBe(false);
    expect(ALL_ON.routeOn('/sports')).toBe(false);
  });

  it('closes a section on a site flag, an owner feature or a capability', () => {
    expect(makeGates({ flags: { vipclub: false } }).routeOn('/vip')).toBe(false);
    expect(makeGates({ features: [{ feature: 'vip' }] }).routeOn('/promotions')).toBe(false);
    const agent = makeGates({ capabilities: AGENT_CAPS });
    expect(agent.agentPlayer).toBe(true);
    expect(agent.on('deposit')).toBe(false);
    expect(agent.routeOn('/blog')).toBe(false);
  });

  it('b2b drops promotions and sign-up for everyone', () => {
    const b2b = makeGates({ features: [{ feature: 'business_model', variant: 'b2b' }, { feature: 'vip' }] });
    expect(b2b.on('vip')).toBe(false);
    expect(b2b.canSignUp()).toBe(false);
  });

  it('a manual-only site keeps deposit open when manual is allowed, closes withdraw on automatic-only', () => {
    const manual = makeGates({ features: [{ feature: 'deposit_mode', variant: 'manual' }, { feature: 'withdrawal_mode', variant: 'automatic' }] });
    expect(manual.on('deposit')).toBe(true);
    expect(manual.autoDeposit()).toBe(false);
    expect(manual.on('withdraw')).toBe(false);
  });
});

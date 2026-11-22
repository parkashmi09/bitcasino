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
    // hash-shaped admin links: VIP follows vip; sports only once `sportsbook` is explicitly on.
    expect(makeGates({ flags: { vipclub: false } }).routeOn('/vip-detail')).toBe(false);
    expect(ALL_ON.routeOn('/sports')).toBe(false);
    expect(makeGates({ flags: { sportsbook: false } }).routeOn('/sports')).toBe(false);
    expect(makeGates({ flags: { sportsbook: true } }).routeOn('/sports/live')).toBe(true);
    // …or the native exchange.
    expect(makeGates({ flags: { sportsbook: false, sportsexchange: true } }).routeOn('/sports/my-bets')).toBe(true);
    expect(makeGates({ flags: { sportsbook: false, sportsexchange: false } }).routeOn('/sports')).toBe(false);
  });

  it('closes a section on a site flag, an owner feature or a capability', () => {
    expect(makeGates({ flags: { vipclub: false } }).routeOn('/vip')).toBe(false);
    expect(makeGates({ features: [{ feature: 'vip' }] }).routeOn('/promotions')).toBe(false);
    const agent = makeGates({ capabilities: AGENT_CAPS });
    expect(agent.agentPlayer).toBe(true);
    expect(agent.on('deposit')).toBe(false);
    expect(agent.routeOn('/vip')).toBe(false);
    expect(agent.routeOn('/blog')).toBe(false);
    expect(agent.on('kyc')).toBe(false);
    expect(agent.on('tips')).toBe(false);
    // Tips follow the owner's plan for a direct player.
    expect(makeGates({ features: [{ feature: 'tips' }] }).on('tips')).toBe(true);
    expect(makeGates({ features: [] }).on('tips')).toBe(false);
  });

  it('treats a visitor on /agent as an agent player, and a signed-in player by their own capabilities', () => {
    const visitor = makeGates({ agentSite: true });
    expect(visitor.agentPlayer).toBe(true);
    expect(visitor.canSignUp()).toBe(false);
    for (const path of ['/promotions', '/vip', '/blog', '/BLOG', '/bl%6Fg/post', '/tournaments', '/bitcoin-breakdown']) {
      expect(visitor.routeOn(path), path).toBe(false);
    }
    expect(visitor.on('deposit')).toBe(false);
    expect(visitor.routeOn('/help-center')).toBe(true);
    // Password changes, money and reward help are closed; ordinary help stays open.
    for (const path of ['/profile/security', '/help-center/help-payment-options', '/help-center/help-your-account/how-do-i-reset-my-password', '/help-center/help-getting-started/bitcasino-verification-kyc-faq', '/help-center/help-terms-and-conditions/affiliate-terms']) {
      expect(visitor.routeOn(path), path).toBe(false);
    }
    expect(visitor.routeOn('/help-center/help-about-bitcoin')).toBe(true);
    expect(makeGates().routeOn('/profile/security')).toBe(true);
    expect(makeGates({ agentSite: true, capabilities: { vault: true, deposit: true } }).agentPlayer).toBe(false);
    expect(makeGates().agentPlayer).toBe(false);
  });

  it('leaves a demo account its sports bets only', () => {
    const demo = makeGates({ capabilities: AGENT_CAPS, demo: true, flags: { sportsexchange: true } });
    expect(demo.routeOn('/sports/my-bets')).toBe(true);
    for (const path of ['/sports/statement', '/profile/settings', '/profile/transactions', '/profile/account']) {
      expect(demo.routeOn(path), path).toBe(false);
    }
    expect(demo.on('notifications')).toBe(false);
  });

  it('b2b drops promotions and sign-up for everyone', () => {
    const b2b = makeGates({ features: [{ feature: 'business_model', variant: 'b2b' }, { feature: 'vip' }] });
    expect(b2b.on('vip')).toBe(false);
    expect(b2b.canSignUp()).toBe(false);
  });

  it('a manual-only site keeps deposit open when manual is allowed; automatic-only withdraw keeps the automatic rail', () => {
    const manual = makeGates({ features: [{ feature: 'deposit_mode', variant: 'manual' }, { feature: 'withdrawal_mode', variant: 'automatic' }] });
    expect(manual.on('deposit')).toBe(true);
    expect(manual.autoDeposit()).toBe(false);
    expect(manual.on('withdraw')).toBe(true);
    expect(manual.autoWithdraw()).toBe(true);
    expect(manual.manualWithdraw()).toBe(false);
  });

  it('the admin manual switch closes the fiat bank queue only', () => {
    const gates = makeGates({ capabilities: { manualWithdraw: false } });
    expect(gates.manualWithdraw(true)).toBe(false);
    expect(gates.manualWithdraw(false)).toBe(true);
    expect(gates.autoWithdraw()).toBe(true);
  });

  it('an agent player has no withdraw rail at all', () => {
    const agent = makeGates({ capabilities: { promotions: false, vault: false, deposit: false, withdraw: false } });
    expect(agent.manualWithdraw(true) || agent.autoWithdraw()).toBe(false);
  });
});

describe('owner theme_mode', () => {
  it('is null until the plan answers, then the owner policy or the dark-only default', () => {
    expect(makeGates({ features: null }).themeMode()).toBeNull();
    expect(makeGates({ features: [] }).themeMode()).toBe('dark_only');
    expect(makeGates({ features: [{ feature: 'theme_mode', variant: 'switch' }] }).themeMode()).toBe('switch');
  });
});

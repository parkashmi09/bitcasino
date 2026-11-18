import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { AGENT_AUTH_CLOSED, agentBaseTarget, underAgentBase, withBase } from './agentBase';

describe('agent base path', () => {
  it('matches /agent and below only', () => {
    expect(underAgentBase('/agent')).toBe(true);
    expect(underAgentBase('/agent/sports')).toBe(true);
    expect(underAgentBase('/agents')).toBe(false);
  });

  it('adds the base to a plain link only on the agent site', () => {
    expect(withBase('/', true)).toBe('/agent');
    expect(withBase('/help-center', true)).toBe('/agent/help-center');
    expect(withBase('/help-center', false)).toBe('/help-center');
  });

  it('moves a player to their own side, keeping the page', () => {
    expect(agentBaseTarget({ pathname: '/sports', search: '?t=1', hash: '#a' }, true)).toBe('/agent/sports?t=1#a');
    expect(agentBaseTarget({ pathname: '/' }, true)).toBe('/agent');
    expect(agentBaseTarget({ pathname: '/agent' }, false)).toBe('/');
    expect(agentBaseTarget({ pathname: '/agent/sports/my-bets' }, false)).toBe('/sports/my-bets');
    expect(agentBaseTarget({ pathname: '/agent/sports' }, true)).toBeNull();
    expect(agentBaseTarget({ pathname: '/sports' }, false)).toBeNull();
  });

  it('closes every recovery and sign-up address, however it is written', () => {
    const routes = AGENT_AUTH_CLOSED.map((path) => ({ path }));
    for (const address of [
      '/forgot-password',
      '/forgot-password/',
      '/FORGOT-PASSWORD',
      '/forgot%2Dpassword',
      '/forgot-password/step-2',
      '/reset-password',
      '/reset-password/abc123',
      '/register',
      '/signup',
      '/login/google',
      '/ref/CODE',
      '/referal/CODE',
    ]) {
      expect(matchRoutes(routes, address), address).not.toBeNull();
    }
    expect(matchRoutes(routes, '/login')).toBeNull();
  });
});

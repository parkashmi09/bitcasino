import { describe, expect, it } from 'vitest';
import { registryNetwork } from './wallet';

describe('registryNetwork', () => {
  it("maps this app's network names to the coin registry's keys", () => {
    expect(registryNetwork('TRX')).toBe('TRC20'); // USDT on Tron, and the TRX coin
    expect(registryNetwork('ETH')).toBe('ERC20'); // the ETH coin's own chain
    expect(registryNetwork('ERC20')).toBe('ERC20');
    expect(registryNetwork('BEP20')).toBe('BEP20');
    expect(registryNetwork('BTC')).toBe('BTC'); // single-chain coins are already keys
    expect(registryNetwork(null)).toBe(null);
  });
});

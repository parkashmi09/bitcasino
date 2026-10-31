'use strict';

const { currencyRegistry } = require('@ibitplay/common');

const { COIN_NETWORKS, SUPPORTED_COINS } = require('./crypto.constants');

/**
 * The networks a coin may be deposited / withdrawn on right now:
 * `[{ key, name }]`, in the registry's order with the registry's names.
 *
 *   - The KEYS are the contract (`COIN_NETWORKS`): a registry entry whose key
 *     is not in the contract is dropped, so renaming in the site admin can
 *     never make a deposit screen offer a chain the backend does not know.
 *   - A network the site switched off is gone; a coin the registry has
 *     switched off has none.
 *   - No registry answer (or no row for the coin): the contract keys, named
 *     by their keys — fails open like the registry itself.
 *   - A coin with no contract here (a custom coin, phase B) takes the
 *     registry's networks as they are.
 */
async function networksFor(coin) {
  const code = String(coin ?? '').trim().toUpperCase();
  const contract = COIN_NETWORKS[code] ?? null;
  const entry = await currencyRegistry.describe(code);
  if (entry && entry.enabled === false) return [];
  const registry = await currencyRegistry.networksOf(code);
  if (registry === null) return (contract ?? []).map((key) => ({ key, name: key }));
  return contract ? registry.filter((n) => contract.includes(n.key)) : registry;
}

/** Every crypto coin this site deposits in, with its networks — coins with none left out. */
async function allNetworks() {
  const out = [];
  for (const coin of SUPPORTED_COINS) {
    if (!COIN_NETWORKS[coin]) continue;
    const networks = await networksFor(coin);
    if (networks.length) out.push({ coin, networks });
  }
  return out;
}

module.exports = { networksFor, allNetworks };

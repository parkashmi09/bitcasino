'use strict';

/**
 * Receiving-address formats per network key (the coin registry's `networks[].key`). A house
 * address that fails here would send players' money nowhere, so the admin save refuses it.
 * Unknown networks get a loose sanity check only.
 */
const FORMATS = {
  TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  ERC20: /^0x[0-9a-fA-F]{40}$/,
  BEP20: /^0x[0-9a-fA-F]{40}$/,
  BTC: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
};
const LOOSE = /^[A-Za-z0-9:_-]{10,128}$/;

/** The first problem with `address` on `network`, or null. */
function addressProblem(network, address) {
  const key = String(network ?? '').trim().toUpperCase();
  const value = String(address ?? '').trim();
  if (!key) return 'the network is required';
  if (!value) return 'the wallet address is required';
  const format = FORMATS[key] ?? LOOSE;
  return format.test(value) ? null : `this is not a valid ${key} address`;
}

module.exports = { addressProblem, FORMATS };

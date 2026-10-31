'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { addressProblem } = require('../cryptoAddress');
const { create } = require('../bankDetails.validators');

test('house crypto addresses are checked per network', () => {
  assert.equal(addressProblem('TRC20', 'TQ5NxSuvQgTr8gp8DJEkH2vpVzUp9YzJ3m'), null);
  assert.match(addressProblem('TRC20', '0x52908400098527886E0F7030069857D2E4169EE7'), /not a valid TRC20/);
  assert.equal(addressProblem('ERC20', '0x52908400098527886E0F7030069857D2E4169EE7'), null);
  assert.equal(addressProblem('BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), null);
  assert.equal(addressProblem('BTC', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'), null);
  assert.match(addressProblem('BTC', 'TQ5NxSuvQgTr8gp8DJEkH2vpVzUp9YzJ3m'), /not a valid BTC/);
  assert.match(addressProblem('', 'x'), /network is required/);
  assert.match(addressProblem('TRC20', ''), /address is required/);
});

test('a destination may be a wallet address alone', () => {
  const ok = create.body.safeParse({ network: 'trc20', walletAddress: 'TQ5NxSuvQgTr8gp8DJEkH2vpVzUp9YzJ3m' });
  assert.equal(ok.success, true);
  assert.equal(ok.data.network, 'TRC20');
  assert.equal(create.body.safeParse({ bankName: 'x' }).success, false, 'still needs an account, UPI id or address');
});

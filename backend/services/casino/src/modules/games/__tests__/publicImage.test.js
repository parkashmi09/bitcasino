'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress, assertPublicHttps } = require('../publicImage');

test('private and special ranges are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('only https to a public address', async () => {
  await assert.rejects(assertPublicHttps('http://8.8.8.8/x.png'), /https only/);
  await assert.rejects(assertPublicHttps('https://127.0.0.1/x.png'), /not a public host/);
  await assert.rejects(assertPublicHttps('https://[::1]/x.png'), /not a public host/);
  await assertPublicHttps('https://8.8.8.8/x.png');
});

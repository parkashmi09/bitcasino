'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');

const { createApiEncryption, ACCEPT } = require('../apiEncryption');
const { createProxy } = require('../proxy');

const KEY = crypto.randomBytes(32);

const open = (enc) => {
  const raw = Buffer.from(enc, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString());
};

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(server));
  });

test('api encryption through the proxy', async (t) => {
  const upstream = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { path: req.url, gzip: req.headers['accept-encoding'] ?? null } }));
  });
  const encryption = createApiEncryption({ config: { API_ENCRYPTION_KEY: KEY.toString('base64') } });
  const app = express().use(createProxy({ target: `http://127.0.0.1:${upstream.address().port}`, name: 'up', encryption }));
  const edge = await listen(app);
  t.after(() => { upstream.close(); edge.close(); });

  const get = async (path, accept) => {
    const res = await fetch(`http://127.0.0.1:${edge.address().port}${path}`, { headers: { accept, 'accept-encoding': 'gzip' } });
    return res.json();
  };

  assert.equal((await get('/api/v1/user/x', ACCEPT)).data.path, '/api/v1/user/x', 'off: plain JSON');

  encryption.set(true);
  const sealed = await get('/api/v1/user/x', `application/json, ${ACCEPT}`);
  assert.ok(sealed.enc && !sealed.data, 'on: only the envelope');
  assert.deepEqual(open(sealed.enc), { success: true, data: { path: '/api/v1/user/x', gzip: null } }, 'decrypts to the answer, fetched uncompressed');

  assert.ok((await get('/api/v1/user/x', 'application/json')).data, 'a caller that does not ask gets plain JSON');
  assert.ok((await get('/api/v1/casino/gis/callback/transactions', ACCEPT)).data, 'provider callbacks stay plain');
  assert.ok((await get('/api/v1/user/psp/upi/callback', ACCEPT)).data, 'payment callbacks stay plain');
  assert.ok((await get('/api/v1/casino/js-games/v2/bet-callback', ACCEPT)).data, 'game callbacks stay plain');
  assert.ok((await get('/api/v1/user/crypto/ccpayment/callback', ACCEPT)).data, 'crypto webhooks stay plain');
  assert.ok((await get('/api/v1/casino/original-games/wallet/bet', ACCEPT)).data, 'original games wallet stays plain');
  assert.ok((await get('/api/v1/user/psp/upi/payout-callback', ACCEPT)).data, 'payout callbacks stay plain');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normaliseJackpots } = require('../jackpots');

const pick = (rows) => rows.map(({ raw, ...row }) => row);

test('a Slotegrator-style list under `items`, per-jackpot currency and game', () => {
  const body = {
    items: [
      { name: 'Mega', amount: '125000.55', currency: 'eur', game_uuid: 'abc-123' },
      { name: 'Mini', amount: 310.2, currency: 'EUR' },
    ],
    _links: {},
    _meta: { totalCount: 2 },
  };
  const rows = normaliseJackpots(body);
  assert.deepEqual(pick(rows), [
    { name: 'Mega', amount: '125000.55', currency: 'EUR', gameId: 'abc-123' },
    { name: 'Mini', amount: '310.2', currency: 'EUR' },
  ]);
  assert.equal(rows[0].raw, body.items[0], 'the provider entry is kept under raw');
});

test('an EGT jackpot-info body: levels nested under data, currency on the body', () => {
  const body = { data: { currency: 'USD', levels: [{ level: 'I', value: 80.1 }, { level: 'IV', currentValue: '15000.00' }] } };
  assert.deepEqual(pick(normaliseJackpots(body)), [
    { name: 'I', amount: '80.1', currency: 'USD' },
    { name: 'IV', amount: '15000.00', currency: 'USD' },
  ]);
});

test('a name -> amount map, currency from the request', () => {
  assert.deepEqual(pick(normaliseJackpots({ clubs: 10, diamonds: '20.5' }, { currency: 'inr' })), [
    { name: 'clubs', amount: '10', currency: 'INR' },
    { name: 'diamonds', amount: '20.5', currency: 'INR' },
  ]);
});

test('a bare array with money objects; unreadable rows and empty bodies give nothing', () => {
  assert.deepEqual(pick(normaliseJackpots([{ title: 'Grand', amount: { value: 999, currency: 'usdt' } }, { title: 'Broken', amount: 'n/a' }])), [
    { name: 'Grand', amount: '999', currency: 'USDT' },
  ]);
  assert.deepEqual(normaliseJackpots(null), []);
  assert.deepEqual(normaliseJackpots({ error: 'nope' }), []);
  assert.deepEqual(normaliseJackpots([]), []);
});

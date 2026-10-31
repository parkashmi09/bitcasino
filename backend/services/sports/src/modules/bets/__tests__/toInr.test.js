'use strict';

const test = require('node:test');
const assert = require('node:assert');

// placeBet's stake conversion and the ledger's delta_currency, against the platform's own rate table (needs the DB).
test.after(async () => (await import('../../../lib/config/db.mjs')).db_default.close());

test('toInr: INR passes through, other coins convert at exchangerate, unknown coin refused', async () => {
  const { toInr } = await import('../../../lib/helper/toInr.mjs');
  const { db_default } = await import('../../../lib/config/db.mjs');

  assert.strictEqual(await toInr(500, 'INR'), 500);

  const [inr] = await db_default.query("SELECT usd_rate FROM public.exchangerate WHERE UPPER(currency) = 'INR'", { type: 'SELECT' });
  assert.strictEqual(await toInr(2, 'usdt'), Math.round((2 / Number(inr.usd_rate)) * 100) / 100);

  await assert.rejects(toInr(1, 'XYZ'), /No exchange rate for XYZ/);
});

test('inrToCurrency: an INR delta back in the bet coin, sign kept', async () => {
  const { inrToCurrency } = await import('../../../lib/helper/toInr.mjs');
  const { db_default } = await import('../../../lib/config/db.mjs');

  assert.strictEqual(await inrToCurrency(-500, 'INR'), -500);
  const [inr] = await db_default.query("SELECT usd_rate FROM public.exchangerate WHERE UPPER(currency) = 'INR'", { type: 'SELECT' });
  assert.strictEqual(await inrToCurrency(-500, 'USDT'), Math.round(-500 * Number(inr.usd_rate) * 1e8) / 1e8);
  await assert.rejects(inrToCurrency(1, 'XYZ'), /No exchange rate for XYZ/);
});

test('inrToUsd: a bet\'s usd_amount at the admin INR rate (₹100 at 0.012 → 1.20, not 1.18)', async () => {
  const { inrToUsd } = await import('../../../lib/helper/toInr.mjs');
  const { db_default } = await import('../../../lib/config/db.mjs');

  const [inr] = await db_default.query("SELECT usd_rate FROM public.exchangerate WHERE UPPER(currency) = 'INR'", { type: 'SELECT' });
  assert.strictEqual(await inrToUsd(100), Math.round(100 * Number(inr.usd_rate) * 100) / 100);
  assert.strictEqual(await inrToUsd(0), 0);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { WalletService, forPlayer } = require('../wallet.service');
const v = require('../wallet.validators');

/**
 * The player's Transaction list (GET /user/wallet/ledger): the Bill-type `category` filter, the
 * sports exchange's mssports rows merged in, and staff notes kept off the player's screen.
 * Skipped (not failed) when no migrated test database is reachable.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const UID = String(930_000_000 + (process.pid % 100_000));

test('forPlayer: a staff-written row reads as a plain label', () => {
  const note = 'QA self-used balance (₹833333.33 from Super Admin wallet)';
  assert.equal(forPlayer({ reason: 'ADMIN_CREDIT', description: note, meta: { refType: 'DIRECT_WALLET' } }).description, 'Credit by admin');
  assert.equal(forPlayer({ reason: 'TRANSFER_IN', amount: '5', description: 'agent note', meta: { refType: 'STAFF_TRANSFER' } }).description, 'Credited by agent');
  assert.equal(forPlayer({ reason: 'TRANSFER_OUT', amount: '-5', description: 'x', meta: { refType: 'TRANSFER' } }).description, 'Transfer out');
  assert.equal(forPlayer({ reason: 'TRANSFER_IN', description: 'Swap USDT -> INR', meta: { swap: true } }).description, 'Swap USDT -> INR');
});

test('the category filter is validated', () => {
  assert.equal(v.listLedger.query.parse({ category: 'swap' }).category, 'swap');
  assert.throws(() => v.listLedger.query.parse({ category: 'nope' }));
});

test('player ledger against PostgreSQL', async (t) => {
  const logger = createLogger({ name: 'player-ledger-test', level: 'silent' });
  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'user-service',
    });
    await connection.sequelize.query('SELECT 1 FROM mssports.debit_ledger LIMIT 1');
  } catch (error) {
    if (connection) await connection.close();
    t.skip(`No migrated test database reachable (${error.message})`);
    return;
  }
  const q = (sql, replacements) => connection.sequelize.query(sql, { replacements, type: 'SELECT' });
  // Deletes only this run's user id.
  const cleanup = async () => {
    await q('DELETE FROM public.credits_ledger WHERE user_id = :uid RETURNING id', { uid: UID });
    await q('DELETE FROM mssports.debit_ledger WHERE user_id = :uid RETURNING id', { uid: UID });
    await q('DELETE FROM mssports.credits_ledger WHERE user_id = :uid RETURNING id', { uid: UID });
    await q('DELETE FROM mssports.point_ledger_direct WHERE user_id = :uid RETURNING id', { uid: UID });
    await q('DELETE FROM og_transactions WHERE user_id = :uid RETURNING id', { uid: UID });
    await q("DELETE FROM og_games WHERE code = 'test-bow' RETURNING code");
    await q('DELETE FROM gis_transactions WHERE user_id = :uid RETURNING id', { uid: UID });
    await q("DELETE FROM gisgamesnew WHERE uuid = 'test-aviator' RETURNING id");
  };
  t.after(async () => {
    await cleanup();
    await connection.close();
  });
  await cleanup();

  const row = (reason, currency, amount, meta, at) =>
    q(`INSERT INTO public.credits_ledger (user_id, currency, amount, reason, description, balance, meta, created_at)
       VALUES (:uid, :currency, :amount, :reason, 'staff note', 0, CAST(:meta AS jsonb), :at) RETURNING id`,
    { uid: UID, currency, amount, reason, meta: JSON.stringify(meta), at });
  await row('ADMIN_CREDIT', 'USDT', '10000', { refType: 'DIRECT_WALLET' }, '2026-10-19T06:00:00Z');
  await row('BONUS', 'USDT', '24', { refType: 'BONUS_GRANT' }, '2026-10-19T06:01:00Z');
  await row('TRANSFER_OUT', 'USDT', '-30', { swap: true }, '2026-10-19T06:02:00Z');
  await row('TRANSFER_IN', 'INR', '2475', { swap: true }, '2026-10-19T06:02:00Z');
  await row('TRANSFER_OUT', 'USDT', '-5', { refType: 'VAULT' }, '2026-10-19T06:03:00Z');
  await row('BET_STAKE', 'USDT', '-1', { refType: 'OG' }, '2026-10-19T06:04:00Z');
  // An Original Games row as casino-service used to write it: named from og_transactions → og_games.
  await q(`UPDATE public.credits_ledger SET description = :d WHERE user_id = :uid AND reason = 'BET_STAKE' RETURNING id`, { uid: UID, d: `original-games bet og-${UID}` });
  await q(`INSERT INTO og_games (code, name, position, data, synced_at) VALUES ('test-bow', 'Arrow Bow', 999, '{}'::jsonb, NOW())
           ON CONFLICT (code) DO NOTHING RETURNING code`);
  await q(`INSERT INTO og_transactions (transaction_id, kind, user_id, game_code, currency, amount) VALUES (:tx, 'bet', :uid, 'test-bow', 'USDT', 1) RETURNING id`, { tx: `og-${UID}`, uid: UID });
  // A Slotegrator row reads "win <tx>": named from gis_transactions → gisgamesnew.
  await row('BET_PAYOUT', 'INR', '20', { refType: 'GIS' }, '2026-10-19T06:04:30Z');
  await q(`UPDATE public.credits_ledger SET description = :d WHERE user_id = :uid AND reason = 'BET_PAYOUT' RETURNING id`, { uid: UID, d: `win gis-${UID}` });
  await q(`INSERT INTO gisgamesnew (uuid, name) VALUES ('test-aviator', 'Aviator') RETURNING id`);
  await q(`INSERT INTO gis_transactions (user_id, transaction_id, action, game_uuid, balance_after) VALUES (:uid, :tx, 'win', 'test-aviator', 0) RETURNING id`, { uid: UID, tx: `gis-${UID}` });
  await q(`INSERT INTO mssports.debit_ledger (user_id, currency, amount, reason, description, balance, created_at)
           VALUES (:uid, 'INR', 100, 'bet_placed', 'Ind v Aus Australia', 2375, '2026-10-19T06:05:00Z') RETURNING id`, { uid: UID });
  await q(`INSERT INTO mssports.credits_ledger (user_id, currency, amount, reason, description, closing, created_at)
           VALUES (:uid, 'INR', 190, 'settlement', 'Ind v Aus / Australia', 2565, '2026-10-19T07:00:00Z') RETURNING id`, { uid: UID });

  const wallet = new WalletService({ models: connection.models, db: connection, config: { SERVICE_NAME: 'user-service' }, logger });
  const list = (extra) => wallet.listLedger({ userId: UID, limit: 25, offset: 0, ...extra });
  const reasons = (r) => r.rows.map((x) => x.reason);

  const all = await list({});
  assert.equal(all.count, 9);
  assert.deepEqual(reasons(all).slice(0, 2), ['SPORTS_SETTLEMENT', 'SPORTS_STAKE'], 'newest first, sports rows merged');
  assert.equal(Number(all.rows[1].amount), -100, 'a stake hold is a debit');
  assert.equal(all.rows.find((x) => x.reason === 'ADMIN_CREDIT').description, 'Credit by admin');
  assert.equal(all.rows.find((x) => x.reason === 'BET_STAKE').description, 'Arrow Bow bet');
  assert.equal(all.rows.find((x) => x.reason === 'BET_PAYOUT').description, 'Aviator win', 'game name, never the transaction id');

  assert.deepEqual(reasons(await list({ category: 'game' })).sort(), ['BET_PAYOUT', 'BET_STAKE', 'SPORTS_SETTLEMENT', 'SPORTS_STAKE']);
  assert.deepEqual(reasons(await list({ category: 'swap' })).sort(), ['TRANSFER_IN', 'TRANSFER_OUT']);
  assert.deepEqual(reasons(await list({ category: 'vault' })), ['TRANSFER_OUT']);
  assert.deepEqual(reasons(await list({ category: 'bonus' })), ['BONUS']);
  assert.equal((await list({ category: 'affiliate' })).count, 0);
  assert.equal((await list({ currency: 'USDT' })).count, 5, 'a non-INR coin has no sports rows');
  assert.equal((await list({ reason: ['BONUS'] })).count, 1, 'a reason filter is the wallet ledger alone');
  assert.equal((await list({ limit: 2, offset: 2 })).rows.length, 2);

  // A LAY (hold −34.50) then a BACK on the same runner (exposure 34.50 → 11.50, +23), then the
  // settlement. The release is in point_ledger_direct only; the LAY's debit_ledger twin is not listed twice.
  const sportsMove = (ref, event, delta, after, betId, at) =>
    q(`INSERT INTO mssports.point_ledger_direct (entry_ref, source, event_type, category, user_id, currency, delta, balance_after, bet_id, remark, created_at)
       VALUES (:ref, 'sports-service', :event, 'OTHER', :uid, 'INR', :delta, :after, :betId, 'Lisbon v LASK LASK', :at) RETURNING id`,
    { ref: `test:${UID}:${ref}`, event, uid: UID, delta, after, betId, at });
  const lay = Number(UID) * 10;
  await sportsMove('lay', 'BET_PLACED', '-34.50', '2530.50', lay, '2026-10-19T08:00:00Z');
  await q(`INSERT INTO mssports.debit_ledger (user_id, currency, amount, reason, description, balance, meta, created_at)
           VALUES (:uid, 'INR', 34.50, 'bet_placed', 'Lisbon v LASK LASK', 2530.50, CAST(:meta AS jsonb), '2026-10-19T08:00:00Z') RETURNING id`,
  { uid: UID, meta: JSON.stringify({ bet_id: lay }) });
  await sportsMove('back', 'BET_RELEASED', '23', '2553.50', lay + 1, '2026-10-19T08:01:00Z');
  await q(`INSERT INTO mssports.credits_ledger (user_id, currency, amount, reason, description, closing, created_at)
           VALUES (:uid, 'INR', 11.50, 'settlement', 'Lisbon v LASK / LASK', 2565, '2026-10-19T09:00:00Z') RETURNING id`, { uid: UID });

  const sports = (await list({ category: 'game' })).rows.filter((x) => x.reason.startsWith('SPORTS_')).reverse();
  assert.deepEqual(sports.map((x) => [x.reason, Number(x.amount), Number(x.balance)]), [
    ['SPORTS_STAKE', -100, 2375],
    ['SPORTS_SETTLEMENT', 190, 2565],
    ['SPORTS_STAKE', -34.5, 2530.5],
    ['SPORTS_RELEASE', 23, 2553.5],
    ['SPORTS_SETTLEMENT', 11.5, 2565],
  ]);
  for (let i = 1; i < sports.length; i += 1) {
    assert.equal(Number(sports[i - 1].balance) + Number(sports[i].amount), Number(sports[i].balance), `player row ${i} chains`);
  }

  const staff = (await wallet.listStaffHistory({ userId: UID, currency: 'INR', limit: 25, offset: 0 })).rows
    .filter((x) => x.id.startsWith('sports-')).reverse();
  assert.deepEqual(staff.map((x) => [x.operation, Number(x.amount), Number(x.new_balance)]), [
    ['debit', 100, 2375],
    ['credit', 190, 2565],
    ['debit', 34.5, 2530.5],
    ['credit', 23, 2553.5],
    ['credit', 11.5, 2565],
  ]);
  assert.match(staff[3].description, /^Sports exposure released — Lisbon v LASK LASK$/);
  for (let i = 1; i < staff.length; i += 1) {
    const signed = staff[i].operation === 'debit' ? -Number(staff[i].amount) : Number(staff[i].amount);
    assert.equal(Number(staff[i - 1].new_balance) + signed, Number(staff[i].new_balance), `staff row ${i} chains`);
  }
});

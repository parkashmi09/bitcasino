'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const {
  createLogger, money, BUILTIN_CURRENCIES, refuseCustomCurrencies, assertCurrencySupportedFor,
  configureCurrencyRegistry, currencyRegistry,
} = require('@ibitplay/common');

const { WalletService } = require('../wallet.service');
const { SwapService } = require('../../swap/swap.service');
const { ExchangeRateService } = require('../../exchange-rate/exchangeRate.service');
const { VaultService } = require('../../vault/vault.service');
const { PaymentOrdersService } = require('../../payment-orders/paymentOrders.service');
const { FiatDepositService } = require('../../fiat-deposit/fiatDeposit.service');
const { FiatWithdrawService } = require('../../fiat-withdraw/fiatWithdraw.service');
const { REASON, CURRENCY_COLUMN, isWalletCurrency } = require('../wallet.constants');
const v = require('../wallet.validators');
const swapV = require('../../swap/swap.validators');
const rateV = require('../../exchange-rate/exchangeRate.validators');
const vaultV = require('../../vault/vault.validators');

/**
 * Custom coins (coin management phase B, migration 065) in the wallet, against
 * a real PostgreSQL: an owner-created coin's balance is a `wallet_balances`
 * row, moved by the same locked, guarded, ledgered path as a `credits` column.
 *
 * Skipped (not failed) when no migrated test database is reachable.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const SUFFIX = String(process.pid % 100_000);
const COIN_A = `ZA${SUFFIX}`;
const COIN_B = `ZB${SUFFIX}`;
const MISSING = `ZX${SUFFIX}`;

let nextUid = 910_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('custom coins in the wallet', async (t) => {
  const logger = createLogger({ name: 'custom-coin-test', level: 'silent' });

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
        DB_POOL_MAX: 25,
      },
      logger,
      service: 'user-service',
    });
    await connection.ping();
    await connection.sequelize.query('SELECT 1 FROM wallet_balances LIMIT 1');
  } catch (error) {
    if (connection) await connection.close();
    t.skip(`No migrated test database reachable (${error.message})`);
    return;
  }

  const { sequelize } = connection;
  const q = (sql, replacements) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
  const uids = [];

  async function cleanup() {
    const codes = [COIN_A, COIN_B, MISSING];
    if (uids.length) {
      await q('DELETE FROM credits_ledger WHERE user_id IN (:ids) RETURNING id', { ids: uids.map(String) });
      await q('DELETE FROM wallet_history WHERE uid IN (:ids) RETURNING id', { ids: uids });
      await q('DELETE FROM swap_history WHERE uid IN (:ids) RETURNING id', { ids: uids });
      await q('DELETE FROM credits WHERE uid IN (:ids) RETURNING uid', { ids: uids });
    }
    await q('DELETE FROM wallet_balances WHERE currency IN (:codes) RETURNING uid', { codes });
    await q('DELETE FROM exchangerate WHERE UPPER(currency) IN (:codes) RETURNING id', { codes });
    await q('DELETE FROM currencies WHERE code IN (:codes) AND builtin = false RETURNING code', { codes });
  }

  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  await cleanup();
  for (const [code, enabled, rate] of [[COIN_A, true, '0.01'], [COIN_B, true, '2']]) {
    await q(
      `INSERT INTO currencies (code, kind, decimals, builtin, owner_enabled, site_enabled, name, symbol, usd_rate, managed_by)
       VALUES (:code, 'points', 2, false, :enabled, true, :code, :code, :rate, 'owner') RETURNING code`,
      { code, enabled, rate }
    );
    await q(
      `INSERT INTO exchangerate (currency, usd_rate, last_updated, managed_by) VALUES (:code, :rate, CURRENT_TIMESTAMP, 'owner') RETURNING id`,
      { code, rate }
    );
  }

  const deps = { models: connection.models, db: connection, config: { SERVICE_NAME: 'user-service' }, logger };
  const wallet = new WalletService(deps);
  const swap = new SwapService(deps);
  const rates = new ExchangeRateService(deps);

  const player = async () => {
    const uid = newUid();
    uids.push(uid);
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Credits.create({ uid, inr: '0' });
    return uid;
  };
  const stored = async (uid, code) => {
    const [row] = await q('SELECT balance FROM wallet_balances WHERE uid = :uid AND currency = :code', { uid, code });
    return money.fromStored(row?.balance ?? '0');
  };
  const credit = (uid, amount, key, code = COIN_A) =>
    wallet.credit({ userId: uid, currency: code, amount, reason: REASON.ADMIN_CREDIT, idempotencyKey: key });
  const debit = (uid, amount, key, code = COIN_A) =>
    wallet.debit({ userId: uid, currency: code, amount, reason: REASON.BET_STAKE, idempotencyKey: key });

  await t.test('the shared builtin list is the wallet allow-list', () => {
    assert.deepEqual([...BUILTIN_CURRENCIES].sort(), Object.keys(CURRENCY_COLUMN).sort());
    assert.equal(isWalletCurrency(COIN_A), true);
    assert.equal(isWalletCurrency('usdt'), true);
    assert.equal(isWalletCurrency('constructor'), false);
    assert.equal(isWalletCurrency('1BAD'), false);
  });

  await t.test('a credit creates the balance row; ledger and history are written', async () => {
    const uid = await player();
    const r = await credit(uid, '100', `cc-credit-${uid}`);
    assert.equal(r.previousBalance, '0.00000000');
    assert.equal(r.newBalance, '100.00000000');
    assert.equal(await stored(uid, COIN_A), '100.00000000');

    const ledger = await q('SELECT currency, amount, reason FROM credits_ledger WHERE user_id = :id', { id: String(uid) });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].currency, COIN_A);
    assert.equal(money.fromStored(ledger[0].amount), '100.00000000');
    const history = await q('SELECT coin, operation FROM wallet_history WHERE uid = :uid', { uid });
    assert.deepEqual(history.map((h) => [h.coin, h.operation]), [[COIN_A, 'credit']]);

    // The INR column was not touched.
    const [row] = await q('SELECT inr FROM credits WHERE uid = :uid', { uid });
    assert.equal(money.fromStored(row.inr ?? '0'), '0.00000000');
  });

  await t.test('a player with no wallet row is created by the first custom credit', async () => {
    const uid = newUid();
    uids.push(uid);
    await credit(uid, '5', `cc-new-${uid}`);
    assert.equal(await stored(uid, COIN_A), '5.00000000');
  });

  await t.test('a debit is guarded: over the balance is refused and writes nothing', async () => {
    const uid = await player();
    await credit(uid, '50', `cc-seed-${uid}`);
    await assert.rejects(() => debit(uid, '75', `cc-over-${uid}`), (e) => e.code === 'WALLET_INSUFFICIENT_FUNDS' && e.status === 402);
    assert.equal(await stored(uid, COIN_A), '50.00000000');
    const r = await debit(uid, '50', `cc-all-${uid}`);
    assert.equal(r.newBalance, '0.00000000');
    assert.equal(await stored(uid, COIN_A), '0.00000000');
    // A debit of a coin the player never held is insufficient funds, not a crash.
    await assert.rejects(() => debit(uid, '1', `cc-none-${uid}`, COIN_B), (e) => e.code === 'WALLET_INSUFFICIENT_FUNDS');
  });

  await t.test('ten concurrent debits of 20 against 100: exactly five succeed, never below zero', async () => {
    const uid = await player();
    await credit(uid, '100', `cc-seed-${uid}`);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => debit(uid, '20', `cc-race-${uid}-${i}`))
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const refused = results.filter((r) => r.status === 'rejected' && r.reason.code === 'WALLET_INSUFFICIENT_FUNDS').length;
    assert.equal(ok, 5);
    assert.equal(refused, 5);
    assert.equal(await stored(uid, COIN_A), '0.00000000');
    const [sum] = await q(`SELECT COALESCE(SUM(amount), 0) AS total FROM credits_ledger WHERE user_id = :id AND currency = :code`, { id: String(uid), code: COIN_A });
    assert.equal(money.fromStored(sum.total), '0.00000000', 'the ledger reconciles with the balance');
    const rec = await wallet.reconcile({ userId: uid, currency: COIN_A });
    assert.equal(rec.balanced, true);
  });

  await t.test('concurrent credits and debits interleave without losing an update', async () => {
    const uid = await player();
    await credit(uid, '10', `cc-seed-${uid}`);
    await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => credit(uid, '3', `cc-mix-c-${uid}-${i}`)),
      ...Array.from({ length: 5 }, (_, i) => debit(uid, '1', `cc-mix-d-${uid}-${i}`)),
    ]);
    assert.equal(await stored(uid, COIN_A), '20.00000000');
  });

  await t.test('a replayed idempotency key moves nothing twice', async () => {
    const uid = await player();
    await credit(uid, '7', `cc-replay-${uid}`);
    const again = await credit(uid, '7', `cc-replay-${uid}`);
    assert.equal(again.replayed, true);
    assert.equal(await stored(uid, COIN_A), '7.00000000');
  });

  await t.test('a code the registry does not know is refused, with nothing written', async () => {
    const uid = await player();
    await assert.rejects(() => credit(uid, '1', `cc-missing-${uid}`, MISSING), (e) => e.code === 'WALLET_UNSUPPORTED_CURRENCY');
    const rows = await q('SELECT 1 FROM credits_ledger WHERE user_id = :id', { id: String(uid) });
    assert.equal(rows.length, 0);
  });

  await t.test('balances merge custom coins; a disabled one shows only while it holds something', async () => {
    const uid = await player();
    await credit(uid, '12.5', `cc-bal-${uid}`);
    // credits.credit_limit (062) is a column on the same row, never a coin.
    await q('UPDATE credits SET credit_limit = 500 WHERE uid = :uid RETURNING uid', { uid });
    let balances = await wallet.getBalances(uid);
    assert.equal(balances[COIN_A], '12.50000000');
    assert.equal(balances[COIN_B], '0.00000000', 'an enabled custom coin is listed at zero');
    assert.equal(balances.INR, '0.00000000');
    assert.equal('CREDIT_LIMIT' in balances, false, 'credits.credit_limit is not a coin');
    assert.deepEqual(Object.keys(balances).filter((k) => !(k in CURRENCY_COLUMN) && ![COIN_A, COIN_B].includes(k)), [], 'only coins');
    assert.equal('CREDIT_LIMIT' in (await swap.getBalances(uid)), false);

    await q('UPDATE currencies SET owner_enabled = false WHERE code IN (:codes) RETURNING code', { codes: [COIN_A, COIN_B] });
    try {
      balances = await wallet.getBalances(uid);
      assert.equal(balances[COIN_A], '12.50000000', 'a disabled coin with a balance stays listed');
      assert.equal(COIN_B in balances, false, 'a disabled coin at zero is hidden');
      assert.equal(await wallet.getBalance(uid, COIN_A), '12.50000000');
    } finally {
      await q('UPDATE currencies SET owner_enabled = true WHERE code IN (:codes) RETURNING code', { codes: [COIN_A, COIN_B] });
    }
  });

  await t.test('the staff listing carries every custom coin on every row', async () => {
    const uid = await player();
    await credit(uid, '3', `cc-list-${uid}`);
    // listBalances asks admin-service for the caller's tree; the root sees everyone.
    const scoped = new WalletService({
      ...deps,
      config: { ...deps.config, ROOT_STAFF_ID: 1 },
      clients: { admin: { get: async () => ({ ids: [1] }) } },
    });
    const name = (await connection.models.Users.findByPk(uid, { attributes: ['name'], raw: true }))?.name;
    if (!name) {
      // No users row for the synthetic uid: check the merge directly instead.
      const rows = await scoped.repo.listCustomBalancesFor([uid]);
      assert.equal(money.fromStored(rows.find((r) => r.currency === COIN_A).balance), '3.00000000');
      assert.ok((await scoped.repo.listCustomCodes()).includes(COIN_B));
      return;
    }
    const { rows } = await scoped.listBalances({ staffId: 1, search: String(uid), limit: 10, offset: 0 });
    assert.equal(rows[0].balances[COIN_A], '3.00000000');
  });

  await t.test('the staff listing filters to holders of one coin (heldCurrency)', async () => {
    const holder = await player();
    const other = await player();
    const tag = `hc${SUFFIX}x`;
    for (const [uid, n] of [[holder, 'a'], [other, 'b']]) {
      await connection.models.Users.destroy({ where: { id: uid } });
      await connection.models.Users.create({ id: uid, name: `${tag}${n}`, password: 'x', status: 'active', parent_staff_id: null });
    }
    try {
      await credit(holder, '2', `hc-a-${holder}`);
      await wallet.credit({ userId: holder, currency: 'USDT', amount: '5', reason: REASON.ADMIN_CREDIT, idempotencyKey: `hc-u-${holder}` });
      await wallet.credit({ userId: other, currency: 'INR', amount: '7', reason: REASON.ADMIN_CREDIT, idempotencyKey: `hc-i-${other}` });
      const scoped = new WalletService({ ...deps, config: { ...deps.config, ROOT_STAFF_ID: 1 }, clients: { admin: { get: async () => ({ ids: [1] }) } } });
      const uidsFor = async (heldCurrency) =>
        (await scoped.listBalances({ staffId: 1, search: tag, heldCurrency, limit: 10, offset: 0 })).rows.map((r) => r.uid).sort();
      assert.deepEqual(await uidsFor(undefined), [holder, other].sort());
      assert.deepEqual(await uidsFor('USDT'), [holder], 'built-in column');
      assert.deepEqual(await uidsFor('INR'), [other]);
      assert.deepEqual(await uidsFor(COIN_A), [holder], 'custom coin');
      assert.deepEqual(await uidsFor('BTC'), []);
      assert.equal(v.adminListBalances.query.safeParse({ heldCurrency: 'usdt' }).data?.heldCurrency, 'USDT');
      assert.equal(v.adminListBalances.query.safeParse({ heldCurrency: 'btc; DROP' }).success, false);
    } finally {
      await connection.models.Users.destroy({ where: { id: [holder, other] } });
    }
  });

  await t.test('swap prices a custom coin through its USD rate, both directions', async () => {
    const uid = await player();
    await credit(uid, '1000', `cc-swap-${uid}`);
    // 1000 A at $0.01, 1% fee → 990 A → $9.90 → 4.95 B at $2.
    const out = await swap.swap({ userId: uid, fromCurrency: COIN_A, toCurrency: COIN_B, amount: '1000' });
    assert.equal(out.toAmount, '4.95000000');
    assert.equal(await stored(uid, COIN_A), '0.00000000');
    assert.equal(await stored(uid, COIN_B), '4.95000000');

    const back = await swap.swap({ userId: uid, fromCurrency: COIN_B, toCurrency: COIN_A, amount: '1' });
    // 1 B, 1% fee → 0.99 B → $1.98 → 198 A.
    assert.equal(back.toAmount, '198.00000000');
    assert.equal(await stored(uid, COIN_A), '198.00000000');

    await assert.rejects(
      () => swap.swap({ userId: uid, fromCurrency: COIN_A, toCurrency: COIN_B, amount: '5000' }),
      (e) => e.code === 'SWAP_INSUFFICIENT_BALANCE'
    );
    const balances = await swap.getBalances(uid);
    assert.equal(balances[COIN_A], '198.00000000');
    assert.equal(balances[COIN_B], '3.95000000');
  });

  await t.test("a custom coin's rate is the owner's: the site's rate editor refuses it", async () => {
    const rate = await rates.getRate(COIN_A);
    assert.equal(rate.usdRate, '0.01000000');
    await assert.rejects(() => rates.updateRate({ currency: COIN_A, usdRate: '5' }), (e) => e.code === 'EXCHANGE_RATE_OWNER_MANAGED');
    await assert.rejects(() => rates.deleteRate(COIN_A), (e) => e.code === 'EXCHANGE_RATE_OWNER_MANAGED');
    await assert.rejects(() => rates.addRate({ currency: MISSING, usdRate: '1' }), (e) => e.code === 'EXCHANGE_RATE_OWNER_MANAGED');
  });

  await t.test('validators accept custom codes where the wallet supports them', () => {
    assert.equal(v.adminAdjust.body.safeParse({ userId: 1, currency: COIN_A.toLowerCase(), amount: '1', operation: 'credit', description: 'x' }).success, true);
    assert.equal(v.movement.body.safeParse({ userId: 1, currency: COIN_A, amount: '1', reason: 'BET_STAKE', idempotencyKey: 'abcdefgh' }).success, true);
    assert.equal(v.adminAdjust.body.safeParse({ userId: 1, currency: '1BAD', amount: '1', operation: 'credit', description: 'x' }).success, false);
    assert.equal(swapV.swap.body.safeParse({ fromCurrency: COIN_A, toCurrency: COIN_B, amount: '1' }).success, true);
    assert.equal(swapV.swap.body.safeParse({ fromCurrency: 'INR', toCurrency: 'BJB', amount: '1' }).success, false, 'retired stays refused as a target');
    assert.equal(rateV.convert.query.safeParse({ from: COIN_A, to: 'USDT', amount: '1' }).success, true);
    assert.equal(vaultV.transferIn.body.safeParse({ coin: COIN_A, amount: '1', lockPeriod: '7d' }).success, true);
    // Tips stay built-in only.
    assert.equal(v.transfer.body.safeParse({ fromUserId: 1, toUserId: 2, currency: COIN_A, amount: '1', idempotencyKey: 'abcdefgh' }).success, false);
  });

  await t.test('a built-in coin the owner switched off: hidden at zero, refused as a target, still spendable', async () => {
    // The registry as user-service reads it, straight from the table (no TTL),
    // so a switch below is seen at once. Reset after: other tests run without one.
    configureCurrencyRegistry({
      read: () => q('SELECT code, (owner_enabled AND site_enabled AND NOT retired) AS enabled FROM currencies'),
      config: { CURRENCY_REGISTRY_TTL_MS: 0 },
    });
    const OFF = 'LTC';
    const [before] = await q('SELECT owner_enabled FROM currencies WHERE code = :code', { code: OFF });
    await q('UPDATE currencies SET owner_enabled = false WHERE code = :code RETURNING code', { code: OFF });
    try {
      const empty = await player();
      const holder = await player();
      await wallet.credit({ userId: holder, currency: OFF, amount: '2', reason: REASON.ADMIN_CREDIT, idempotencyKey: `off-seed-${holder}` });

      assert.equal(OFF in (await wallet.getBalances(empty)), false, 'a switched-off coin at zero is hidden');
      assert.equal((await wallet.getBalances(empty)).INR, '0.00000000', 'an enabled built-in at zero stays');
      assert.equal((await wallet.getBalances(holder))[OFF], '2.00000000', 'a switched-off coin with a balance stays');

      // The staff listing: the same rule per row (rows built from the repo directly
      // when the synthetic uids have no users row — see the listing test above).
      const scoped = new WalletService({ ...deps, config: { ...deps.config, ROOT_STAFF_ID: 1 }, clients: { admin: { get: async () => ({ ids: [1] }) } } });
      scoped.repo.listPlayerWallets = async () => ({
        rows: [
          { uid: empty, name: 'e', wallet: await scoped.repo.findWallet(empty) },
          { uid: holder, name: 'h', wallet: await scoped.repo.findWallet(holder) },
        ],
        total: 2,
      });
      const { rows } = await scoped.listBalances({ staffId: 1, limit: 10, offset: 0 });
      assert.equal(OFF in rows[0].balances, false);
      assert.equal(rows[0].balances.INR, '0.00000000');
      assert.equal(rows[1].balances[OFF], '2.00000000');

      // Not a swap target (built-in now, not only custom) — refused before any lock.
      await assert.rejects(
        () => swap.swap({ userId: holder, fromCurrency: 'INR', toCurrency: OFF, amount: '1' }),
        (e) => e.code === 'SWAP_CURRENCY_DISABLED' && e.status === 422
      );
      await assert.rejects(
        () => swap.swap({ userId: holder, fromCurrency: COIN_A, toCurrency: OFF, amount: '1' }),
        (e) => e.code === 'SWAP_CURRENCY_DISABLED'
      );

      // Deposits, payouts and vault-in in it are refused: 422 CURRENCY_DISABLED.
      // No SiteFeature model: the site policy reads its permissive default here.
      const open = { ...deps, models: { ...connection.models, SiteFeature: undefined }, config: { ...deps.config, AUTO_WITHDRAWALS_ENABLED: true } };
      const disabled = (e) => e.code === 'CURRENCY_DISABLED' && e.status === 422 && e.details?.currency === OFF;
      await assert.rejects(() => new VaultService(open).transferIn({ userId: holder, coin: OFF, amount: '1', lockPeriod: '7d' }), disabled);
      await assert.rejects(() => new PaymentOrdersService(open).createDeposit({ userId: holder, provider: 'ccpayment', currency: OFF, amount: '1' }), disabled);
      await assert.rejects(() => new PaymentOrdersService(open).createWithdrawal({ userId: holder, provider: 'ccpayment', currency: OFF, amount: '1' }), disabled);
      await assert.rejects(() => new FiatDepositService(open).create({ userId: holder, details: { currency: OFF, amount: '1', transactionId: `off-${holder}` } }), disabled);
      await assert.rejects(() => new FiatWithdrawService(open).create({ userId: holder, details: { currency: OFF, amount: '1' } }), disabled);
      // An enabled coin passes the registry check (and fails later, on the screenshot).
      await assert.rejects(
        () => new FiatDepositService(open).create({ userId: holder, details: { currency: 'INR', amount: '1', transactionId: `on-${holder}` } }),
        (e) => e.code !== 'CURRENCY_DISABLED'
      );

      // The balance itself still moves: a player can spend the coin down.
      const spent = await wallet.debit({ userId: holder, currency: OFF, amount: '2', reason: REASON.BET_STAKE, idempotencyKey: `off-spend-${holder}` });
      assert.equal(spent.newBalance, '0.00000000');
      assert.equal(OFF in (await wallet.getBalances(holder)), false, 'hidden again once it is empty');
    } finally {
      await q('UPDATE currencies SET owner_enabled = :on WHERE code = :code RETURNING code', { code: OFF, on: before?.owner_enabled ?? true });
      currencyRegistry.resetCurrencyRegistry();
    }
  });

  await t.test('a registry outage hides nothing, but money rails refuse (fail closed)', async () => {
    configureCurrencyRegistry({ read: () => { throw new Error('admin-service down'); }, config: { CURRENCY_REGISTRY_TTL_MS: 0 } });
    try {
      assert.equal((await currencyRegistry.disabledCodes()).size, 0);
      await assert.rejects(currencyRegistry.assertCurrencyEnabled('LTC'), (e) => e.code === 'CURRENCY_REGISTRY_UNAVAILABLE');
      const uid = await player();
      assert.equal((await wallet.getBalances(uid)).LTC, '0.00000000');
    } finally {
      currencyRegistry.resetCurrencyRegistry();
    }
  });
});

test('custom coins are refused by deposits, withdrawals, games and sports', async (t) => {
  const run = (feature, req) =>
    new Promise((resolve) => {
      refuseCustomCurrencies(feature)(req, {}, (err) => resolve(err ?? null));
    });

  await t.test('the router guard names the feature', async () => {
    const dep = await run('DEPOSIT', { body: { currency: 'QAC' }, query: {}, params: {} });
    assert.equal(dep.code, 'CURRENCY_NOT_SUPPORTED_FOR_DEPOSIT');
    assert.equal(dep.status, 422);
    assert.deepEqual(dep.details, { currency: 'QAC', feature: 'DEPOSIT' });

    const wd = await run('WITHDRAWAL', { body: { coin_type: 'qac' }, query: {}, params: {} });
    assert.equal(wd.code, 'CURRENCY_NOT_SUPPORTED_FOR_WITHDRAWAL');
    const games = await run('GAMES', { body: {}, query: { currencyCode: 'QAC' }, params: {} });
    assert.equal(games.code, 'CURRENCY_NOT_SUPPORTED_FOR_GAMES');
    const sports = await run('SPORTS', { body: { original_currency: 'QAC' }, query: {}, params: {} });
    assert.equal(sports.code, 'CURRENCY_NOT_SUPPORTED_FOR_SPORTS');
  });

  await t.test('built-in coins and non-codes pass through to the module', async () => {
    assert.equal(await run('DEPOSIT', { body: { currency: 'INR', coin: 'usdt' }, query: {}, params: {} }), null);
    assert.equal(await run('DEPOSIT', { body: { currency: 'not a code' }, query: {}, params: {} }), null);
    assert.equal(await run('DEPOSIT', { body: null, query: undefined, params: {} }), null);
  });

  await t.test('the socket assertion refuses the same way', () => {
    assert.throws(() => assertCurrencySupportedFor('WITHDRAWAL', 'QAC'), (e) => e.code === 'CURRENCY_NOT_SUPPORTED_FOR_WITHDRAWAL');
    assert.doesNotThrow(() => assertCurrencySupportedFor('WITHDRAWAL', 'BTC'));
    assert.doesNotThrow(() => assertCurrencySupportedFor('GAMES', undefined));
  });

  await t.test('the in-house engine refuses a custom coin by name', async () => {
    const { GameEngine } = require('../../../../../casino/src/modules/in-house/engine/gameEngine');
    const engine = Object.create(GameEngine.prototype);
    await assert.rejects(
      () => engine.placeBet({ userId: 1, game: 'dice', coin: 'QAC', amount: '1', data: {} }),
      (e) => e.code === 'CURRENCY_NOT_SUPPORTED_FOR_GAMES'
    );
  });

  await t.test('the mounted guards sit on every provider-backed player router', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..', '..', '..', '..', '..');
    const expected = {
      'user/src/modules/crypto/routes/user.routes.js': 'DEPOSIT',
      'user/src/modules/fiat-deposit/routes/user.routes.js': 'DEPOSIT',
      'user/src/modules/psp/routes/user.routes.js': 'DEPOSIT',
      'user/src/modules/payment-orders/routes/user.routes.js': 'DEPOSIT',
      'user/src/modules/crypto-withdraw/routes/user.routes.js': 'WITHDRAWAL',
      'user/src/modules/fiat-withdraw/routes/user.routes.js': 'WITHDRAWAL',
      'user/src/modules/bank-details/routes/user.routes.js': 'WITHDRAWAL',
      'user/src/modules/p2p/routes/user.routes.js': 'P2P',
      'casino/src/modules/gis/routes/user.routes.js': 'GAMES',
      'casino/src/modules/js-games/routes/user.routes.js': 'GAMES',
      'casino/src/modules/x-casino/routes/user.routes.js': 'GAMES',
      'casino/src/modules/seamless/routes/user.routes.js': 'GAMES',
      'casino/src/modules/games/routes/user.routes.js': 'GAMES',
      'casino/src/modules/sportsbook/routes/user.routes.js': 'SPORTS',
      'sports/src/modules/bets/routes/public.routes.js': 'SPORTS',
    };
    for (const [file, feature] of Object.entries(expected)) {
      const src = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(src.includes(`router.use(refuseCustomCurrencies('${feature}'))`), `${file} refuses custom coins for ${feature}`);
    }
  });
});

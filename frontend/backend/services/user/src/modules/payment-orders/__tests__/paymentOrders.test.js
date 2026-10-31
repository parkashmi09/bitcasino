'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { PaymentOrdersService } = require('../paymentOrders.service');
const { validatePayoutDetails } = require('../payoutDetails');

/**
 * Starting a payment — and the payout hole.
 *
 * The legacy payout endpoints were all reachable without a token and all took
 * the user id from the request body. `POST /remotes/create-withdrawal` would
 * debit any player named in the body and send a real IMPS transfer to the bank
 * account in that same body. The other two never checked a balance at all.
 *
 * There is no test below for "an unauthenticated caller cannot withdraw",
 * because it is not expressible: this service has no parameter for a user id.
 * The routers take it from the verified token and the schemas are strict, so a
 * request carrying one is rejected before a controller sees it. What IS tested
 * is everything downstream of that — that a payout holds the balance, that a
 * failure gives it back, and that neither happens twice.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 970_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

const BANK = { account_name: 'Test Player', account_number: '123456789', bank_code: 'BKID0000001' };

test('payment orders', async (t) => {
  const logger = createLogger({ name: 'payment-orders-test', level: 'silent' });

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
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  const baseConfig = {
    SERVICE_NAME: 'user-service',
    PUBLIC_BASE_URL: 'https://api.example.test',
    AUTO_WITHDRAWALS_ENABLED: true,
    WITHDRAW_REQUIRE_KYC: false,
    DEPOSIT_MINIMUM: '1',
    DEPOSIT_MAXIMUM: '100000',
    WITHDRAW_MINIMUM: '1',
    WITHDRAW_MAXIMUM: '50000',
    APAY_API_KEY: 'apay-key',
    APAY_PROJECT_ID: '1234',
    APAY_BASE_URL: 'https://apay.test',
    WAYPAY_MERCHANT_KEY: 'waypay-key',
    WAYPAY_BASE_URL: 'https://waypay.test',
    CRICPAY_MERCHANT_CODE: 'CP-TEST',
    CRICPAY_BASE_URL: 'https://cricpay.test',
    UPI_API_KEY: 'upi-key',
    UPI_BASE_URL: 'https://upi.test',
    CCPAYMENT_APP_ID: 'cc-app',
    CCPAYMENT_APP_SECRET: 'cc-secret',
    CCPAYMENT_BASE_URL: 'https://ccpayment.test',
    CCPAYMENT_RETURN_URL: 'https://play.example.test/wallet',
    // CCPayment identifies coins numerically and the ids differ per account,
    // so the map is configuration rather than a constant.
    CCPAYMENT_COIN_IDS: { USDT: 1280, BTC: 1000, ETH: 1001 },
  };

  /** A service whose gateway answers however the test needs. */
  const build = (respond, config = {}) => {
    const calls = [];
    const handler = async (url, body) => {
      calls.push({ url, body });
      return respond(url, body);
    };
    const service = new PaymentOrdersService({
      models: connection.models,
      db: connection,
      logger,
      config: { ...baseConfig, ...config },
      http: {
        post: handler,
        get: handler,
        form: handler,
        // CCPayment signs the serialised body, so its adapter sends a string
        // rather than an object. The stub records it as `body` either way.
        raw: async (url, { body, headers } = {}) => {
          calls.push({ url, body, headers });
          return respond(url, body);
        },
      },
    });
    return { service, calls };
  };

  /**
   * A success, in whichever dialect the provider being called speaks.
   *
   * The four gateways do not agree on what "it worked" looks like: A-Pay sends
   * `{success:true}`, WayPay `{code:0}`, CricPay `{status:'Success'}` and UPI
   * `{status:true}`. A single stub shape would silently make three of the four
   * look like failures — which is the same class of confusion that had the
   * legacy WayPay handler return rejected orders to the client as successes.
   */
  const ok = (url) => {
    if (url.includes('waypay')) return { code: 0, data: { transaction_Id: 'WP-1', payUrl: 'https://pay.example/abc' } };
    if (url.includes('cricpay')) return { status: 'Success', accessURL: 'https://pay.example/abc' };
    if (url.includes('upi')) return { status: true, data: { order_id: 'UPI-1', payment_url: 'https://pay.example/abc' } };
    if (url.includes('ccpayment')) {
      return {
        code: 10000,
        data: {
          address: 'TXn2mQeMhEsLJW1ChVWFMSMeRDow5oREqj',
          amount: '25',
          memo: null,
          checkoutUrl: 'https://pay.example/cc',
          confirmsNeeded: 12,
          status: 'Processing',
        },
      };
    }
    return { success: true, order_id: 'PROVIDER-1', url: 'https://pay.example/abc' };
  };

  const seed = async (uid, inr) => {
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({ id: uid, name: `pay-${uid}`, password: 'x', status: 'active' });
    await connection.models.Credits.create({ uid, inr });
  };

  const balanceOf = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  // ══════════════════════════════════════════════════════════════════════
  //  Withdrawals — the hole
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a withdrawal HOLDS the balance before the gateway is called', async () => {
    // Legacy's cricpay and waypay payouts never touched the balance — they sent
    // an instruction and the money left the merchant float with no player
    // debited and no upper bound.
    const uid = newUid();
    await seed(uid, '1000');

    const { service, calls } = build(ok);
    const result = await service.createWithdrawal({
      userId: uid, provider: 'apay', currency: 'INR', amount: '400', details: BANK,
    });

    assert.equal(result.status, 'pending');
    assert.equal(await balanceOf(uid), '600.00000000', 'the balance must be held, not merely recorded');
    assert.equal(calls.length, 1, 'the gateway is called once');
  });

  await t.test('a withdrawal above the balance never reaches the gateway', async () => {
    const uid = newUid();
    await seed(uid, '50');

    const { service, calls } = build(ok);
    await assert.rejects(
      () => service.createWithdrawal({
        userId: uid, provider: 'apay', currency: 'INR', amount: '500', details: BANK,
      }),
      (err) => err.code === 'PAYORDER_INSUFFICIENT_BALANCE' && err.status === 402
    );

    assert.equal(await balanceOf(uid), '50.00000000');
    assert.equal(calls.length, 0, 'no payout instruction may be sent for money that is not there');
  });

  await t.test('a gateway REJECTION refunds the held balance', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const { service } = build(() => ({ success: false, message: 'channel maintenance' }));

    await assert.rejects(
      () => service.createWithdrawal({
        userId: uid, provider: 'apay', currency: 'INR', amount: '300', details: BANK,
      }),
      (err) => err.code === 'PAYORDER_PROVIDER_REJECTED'
    );

    assert.equal(await balanceOf(uid), '1000.00000000', 'a rejected payout must not cost the player anything');
  });

  await t.test('a gateway TIMEOUT refunds the held balance', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const { service } = build(() => {
      const error = new Error('The payment provider did not respond');
      error.code = 'PSP_PROVIDER_UNREACHABLE';
      throw error;
    });

    await assert.rejects(() =>
      service.createWithdrawal({
        userId: uid, provider: 'apay', currency: 'INR', amount: '300', details: BANK,
      })
    );

    assert.equal(await balanceOf(uid), '1000.00000000');
  });

  await t.test('the refund lands exactly once even if the failure path runs twice', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const { service } = build(() => ({ success: false, message: 'nope' }));

    await Promise.all([
      service.createWithdrawal({ userId: uid, provider: 'apay', currency: 'INR', amount: '100', details: BANK })
        .catch(() => null),
      service.createWithdrawal({ userId: uid, provider: 'apay', currency: 'INR', amount: '100', details: BANK })
        .catch(() => null),
    ]);

    assert.equal(await balanceOf(uid), '1000.00000000', 'two failures must return exactly what they took');
  });

  await t.test('a held withdrawal appears on the player statement', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const { service } = build(ok);
    await service.createWithdrawal({
      userId: uid, provider: 'apay', currency: 'INR', amount: '250', details: BANK,
    });

    const ledger = await connection.models.CreditsLedger.findAll({
      where: { user_id: String(uid) }, raw: true,
    });
    assert.equal(ledger.length, 1, 'legacy moved this money with a raw UPDATE and wrote nothing');
    assert.equal(money.toDecimalString(money.toMinor(ledger[0].amount)), '-250.00000000');
  });

  await t.test('withdrawals can be switched off without a deploy', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const { service, calls } = build(ok, { AUTO_WITHDRAWALS_ENABLED: false });
    await assert.rejects(
      () => service.createWithdrawal({
        userId: uid, provider: 'apay', currency: 'INR', amount: '100', details: BANK,
      }),
      (err) => err.code === 'PAYORDER_WITHDRAWALS_DISABLED' && err.status === 503
    );

    assert.equal(calls.length, 0);
    assert.equal(await balanceOf(uid), '1000.00000000');
  });

  await t.test('an amount above the maximum is refused — legacy had no upper bound', async () => {
    const uid = newUid();
    await seed(uid, '10000000');

    const { service, calls } = build(ok);
    await assert.rejects(
      () => service.createWithdrawal({
        userId: uid, provider: 'apay', currency: 'INR', amount: '999999', details: BANK,
      }),
      (err) => err.code === 'PAYORDER_ABOVE_MAXIMUM'
    );
    assert.equal(calls.length, 0);
  });

  await t.test('unverified identity blocks a payout when KYC is required', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const { service, calls } = build(ok, { WITHDRAW_REQUIRE_KYC: true });
    await assert.rejects(
      () => service.createWithdrawal({
        userId: uid, provider: 'apay', currency: 'INR', amount: '100', details: BANK,
      }),
      (err) => err.code === 'PAYORDER_KYC_REQUIRED' && err.status === 403
    );

    assert.equal(await balanceOf(uid), '1000.00000000');
    assert.equal(calls.length, 0);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Payout destinations
  // ══════════════════════════════════════════════════════════════════════

  await t.test('bad payout details are refused BEFORE the balance is held', async () => {
    const uid = newUid();
    await seed(uid, '1000');

    const { service, calls } = build(ok);
    await assert.rejects(
      () => service.createWithdrawal({
        userId: uid, provider: 'apay', currency: 'INR', amount: '100',
        details: { ...BANK, bank_code: 'NOTANIFSC' },
      }),
      (err) => err.code === 'PAYORDER_INVALID_PAYOUT_DETAILS'
    );

    assert.equal(await balanceOf(uid), '1000.00000000', 'a typo must not lock a player out of their money');
    assert.equal(calls.length, 0);
  });

  await t.test('an unknown payment system is refused, not passed through', async () => {
    // Legacy's default branch let unrecognised systems through on the reasoning
    // that the provider would validate them — after we had held the balance.
    const result = validatePayoutDetails('something_invented', { account_number: '1' });
    assert.equal(result.ok, false);
  });

  await t.test('payout schemas reject extra fields', async () => {
    const result = validatePayoutDetails('imps', { ...BANK, sneaky: 'value' });
    assert.equal(result.ok, false, 'an unexamined field would travel to the provider untouched');
  });

  await t.test('each payment system enforces its own shape', async () => {
    assert.equal(validatePayoutDetails('imps', BANK).ok, true);
    assert.equal(validatePayoutDetails('bkash_api_v', { account_number: '01712345678' }).ok, true);
    assert.equal(validatePayoutDetails('bkash_api_v', { account_number: '9912345678' }).ok, false);
    assert.equal(validatePayoutDetails('esewa_p2p', { payment_method: 'phone', phone_number: '9800000000' }).ok, true);
    // The union branch means bank fields cannot ride along on a phone payout.
    assert.equal(
      validatePayoutDetails('esewa_p2p', { payment_method: 'phone', phone_number: '9800000000', bank_name: 'X' }).ok,
      false
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Deposits
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a deposit records a PENDING row before the player can pay', async () => {
    // The inbound amount check compares the callback against this row. If the
    // row were written after the gateway call and that write failed, a player
    // could pay against a deposit we have no record of.
    const uid = newUid();
    await seed(uid, '0');

    const { service } = build(ok);
    const result = await service.createDeposit({
      userId: uid, provider: 'apay', currency: 'INR', amount: '500', method: 'phonepe',
    });

    assert.equal(result.status, 'pending');
    assert.equal(await balanceOf(uid), '0.00000000', 'nothing is credited until the callback is verified');

    const row = await connection.models.Apaydeposits.findOne({
      where: { custom_transaction_id: result.reference }, raw: true,
    });
    assert.ok(row, 'the pending record must exist');
    assert.equal(money.toDecimalString(money.toMinor(row.amount)), '500.00000000');
  });

  await t.test('the notify url is ours, not the caller’s', async () => {
    const uid = newUid();
    await seed(uid, '0');

    const { service, calls } = build(ok);
    await service.createDeposit({ userId: uid, provider: 'waypay', currency: 'INR', amount: '100', method: 'UPI' });

    assert.match(
      calls[0].body.notify_url,
      /^https:\/\/api\.example\.test\//,
      'legacy took notify_url from the request body, so the caller chose where the result went'
    );
  });

  await t.test('a rejected deposit is recorded as failed, not left pending', async () => {
    const uid = newUid();
    await seed(uid, '0');

    const { service } = build(() => ({ success: false, message: 'channel down' }));
    await assert.rejects(
      () => service.createDeposit({ userId: uid, provider: 'apay', currency: 'INR', amount: '100' }),
      (err) => err.code === 'PAYORDER_PROVIDER_REJECTED'
    );

    const row = await connection.models.Apaydeposits.findOne({
      where: { user_id: uid }, order: [['id', 'DESC']], raw: true,
    });
    assert.equal(row.status, 'Failed');
  });

  await t.test('an unsupported currency is refused per provider', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const { service, calls } = build(ok);

    // CricPay is INR-only.
    await assert.rejects(
      () => service.createDeposit({ userId: uid, provider: 'cricpay', currency: 'BDT', amount: '100' }),
      (err) => err.code === 'PAYORDER_CURRENCY_NOT_SUPPORTED'
    );
    // UPI cannot pay out at all.
    await assert.rejects(
      () => service.createWithdrawal({ userId: uid, provider: 'upi', currency: 'INR', amount: '100', details: BANK }),
      (err) => err.code === 'PAYORDER_CURRENCY_NOT_SUPPORTED'
    );
    assert.equal(calls.length, 0);
  });

  await t.test('a provider with no credentials refuses rather than sending an unsigned request', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const { service } = build(ok, { APAY_API_KEY: '' });

    await assert.rejects(
      () => service.createDeposit({ userId: uid, provider: 'apay', currency: 'INR', amount: '100' }),
      (err) => err.code === 'PAYORDER_PROVIDER_DISABLED' && err.status === 503
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a player cannot read another player order', async () => {
    // Legacy's status endpoints took a reference and returned whatever they
    // found — amount, bank account and all.
    const owner = newUid();
    const attacker = newUid();
    await seed(owner, '0');
    await seed(attacker, '0');

    const { service } = build(ok);
    const order = await service.createDeposit({
      userId: owner, provider: 'apay', currency: 'INR', amount: '100',
    });

    await assert.rejects(
      () => service.getOrder({ userId: attacker, provider: 'apay', reference: order.reference }),
      (err) => err.code === 'PAYORDER_ORDER_NOT_FOUND'
    );

    const own = await service.getOrder({ userId: owner, provider: 'apay', reference: order.reference });
    assert.equal(own.reference, order.reference);
  });

  await t.test('a waypay pay-in status lookup finds the PAY-IN row', async () => {
    // Legacy read `req.params.type` on a route that never sets it, so every
    // pay-in status lookup queried the payout table instead.
    const uid = newUid();
    await seed(uid, '0');

    const { service } = build(() => ({ code: 0, data: { transaction_Id: 'WP-1' } }));
    const order = await service.createDeposit({
      userId: uid, provider: 'waypay', currency: 'INR', amount: '100', method: 'UPI',
    });

    const found = await service.getOrder({ userId: uid, provider: 'waypay', reference: order.reference });
    assert.equal(found.flow, 'payin');
    assert.equal(found.amount, '100.00000000');
  });

  await t.test('statuses from four providers read as one vocabulary', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const { service } = build(ok);

    await service.createDeposit({ userId: uid, provider: 'apay', currency: 'INR', amount: '100' });
    await service.createDeposit({ userId: uid, provider: 'cricpay', currency: 'INR', amount: '200' });

    const orders = await service.listOrders({ userId: uid });
    assert.equal(orders.length, 2);
    // 'Pending' and 'Pending' spelled differently in two tables, one word out.
    assert.ok(orders.every((o) => o.status === 'pending'));
    assert.ok(orders.every((o) => o.rawStatus !== undefined), 'the provider’s own word is kept for support');
  });
  // ══════════════════════════════════════════════════════════════════════
  //  CCPayment — the crypto deposit address
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the order id is generated, never taken from the caller', async () => {
    /**
     * Legacy: `const { coinId, price, orderId, chain, ..., userid } = req.body`
     * on an unauthenticated route. `orderId` is the key
     * `/api/ccpaymentnotify` resolves an incoming payment against, so
     * submitting an id another player was already waiting on pointed that
     * player's deposit at whichever row the callback found.
     *
     * The schema is strict and has no `orderId`, and the service generates the
     * reference — there is no parameter to pass one through.
     */
    const uid = newUid();
    await seed(uid, '0');
    const { service, calls } = build(ok);

    const order = await service.createDeposit({
      userId: uid, provider: 'ccpayment', currency: 'USDT', amount: '25', chain: 'TRC20',
    });

    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.orderId, order.reference);
    assert.match(order.reference, /^DEP_/);

    const row = await connection.models.Ccdeposit.findOne({
      where: { orderid: order.reference }, raw: true,
    });
    assert.ok(row, 'the pending row is written BEFORE the provider is called');
    assert.equal(String(row.userid), String(uid));
  });

  await t.test('the deposit address comes back on the order', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const { service } = build(ok);

    const order = await service.createDeposit({
      userId: uid, provider: 'ccpayment', currency: 'USDT', amount: '25', chain: 'TRC20',
    });

    assert.equal(order.details.address, 'TXn2mQeMhEsLJW1ChVWFMSMeRDow5oREqj');
    assert.equal(order.details.confirmsNeeded, 12);

    const row = await connection.models.Ccdeposit.findOne({
      where: { orderid: order.reference }, raw: true,
    });
    assert.equal(row.deposit_address, 'TXn2mQeMhEsLJW1ChVWFMSMeRDow5oREqj');
  });

  await t.test('the signed bytes are the bytes sent', async () => {
    // CCPayment signs `appId + timestamp + body`, covering the body byte for
    // byte. Serialising once to sign and again to send can reorder keys and
    // produce a signature the provider cannot verify.
    const uid = newUid();
    await seed(uid, '0');
    const { service, calls } = build(ok);

    await service.createDeposit({
      userId: uid, provider: 'ccpayment', currency: 'USDT', amount: '25', chain: 'TRC20',
    });

    const { body, headers } = calls[0];
    assert.equal(typeof body, 'string', 'the adapter must hand over an already-serialised body');

    const crypto = require('node:crypto');
    const expected = crypto
      .createHmac('sha256', 'cc-secret')
      .update(`cc-app${headers.Timestamp}${body}`)
      .digest('hex');
    assert.equal(headers.Sign, expected);
  });

  await t.test('an unknown coin is refused before the provider is called', async () => {
    // Legacy passed `coinId` straight through, so an unknown coin produced a
    // provider error where a 422 belongs.
    const uid = newUid();
    await seed(uid, '0');
    const { service, calls } = build(ok);

    await assert.rejects(
      () => service.createDeposit({
        userId: uid, provider: 'ccpayment', currency: 'DOGECOIN2', amount: '25', chain: 'TRC20',
      }),
      (err) => err.code === 'PAYORDER_CURRENCY_NOT_SUPPORTED'
    );
    assert.equal(calls.length, 0, 'nothing should reach the provider');
  });

  await t.test('a rejected order is marked failed, not left Processing', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const { service } = build((url) =>
      url.includes('ccpayment') ? { code: 40004, msg: 'chain not supported' } : ok(url)
    );

    await assert.rejects(
      () => service.createDeposit({
        userId: uid, provider: 'ccpayment', currency: 'USDT', amount: '25', chain: 'TRC20',
      }),
      (err) => err.code === 'PAYORDER_PROVIDER_REJECTED'
    );

    const row = await connection.models.Ccdeposit.findOne({
      where: { userid: String(uid) }, order: [['id', 'DESC']], raw: true,
    });
    assert.equal(row.status, 'Failed');
  });

  await t.test('a status read cannot see another player’s order', async () => {
    // `POST /getOrder` and `POST /checkorderstatusupi` were unauthenticated
    // proxies: an id in, the provider's raw answer out. EkQR's reply carries
    // the payer's name, email and mobile number.
    const owner = newUid();
    const stranger = newUid();
    await seed(owner, '0');
    await seed(stranger, '0');
    const { service, calls } = build(ok);

    const order = await service.createDeposit({
      userId: owner, provider: 'ccpayment', currency: 'USDT', amount: '25', chain: 'TRC20',
    });
    const before = calls.length;

    await assert.rejects(
      () => service.refreshStatus({
        userId: stranger, provider: 'ccpayment', reference: order.reference,
      }),
      (err) => err.code === 'PAYORDER_ORDER_NOT_FOUND'
    );
    assert.equal(calls.length, before, 'the provider must not be contacted for someone else’s order');
  });

  await t.test('a UPI status lookup sends the date from OUR record, not the request', async () => {
    /**
     * EkQR wants `txn_date` alongside the id. Legacy took it from the request
     * body, so a caller could probe an id against dates until one matched — and
     * built its own date by adding 5½ hours to the epoch and then reading the
     * result with the LOCAL accessors, which double-shifts on an IST host.
     */
    const uid = newUid();
    await seed(uid, '0');
    const { service, calls } = build(ok);

    const order = await service.createDeposit({
      userId: uid, provider: 'upi', currency: 'INR', amount: '100',
    });

    const before = calls.length;
    await service.refreshStatus({ userId: uid, provider: 'upi', reference: order.reference });

    const lookup = calls[before];
    assert.match(lookup.url, /check_order_status/);
    assert.match(lookup.body.txn_date, /^\d{2}-\d{2}-\d{4}$/);
    assert.equal(lookup.body.client_txn_id, order.reference);
  });

  await t.test('a crypto deposit shows up in the player’s order list', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const { service } = build(ok);

    await service.createDeposit({
      userId: uid, provider: 'ccpayment', currency: 'USDT', amount: '25', chain: 'TRC20',
    });

    const orders = await service.listOrders({ userId: uid });
    const cc = orders.find((o) => o.provider === 'ccpayment');
    assert.ok(cc);
    // CCPayment says 'Processing' where the others say 'Pending'.
    assert.equal(cc.status, 'pending');
    assert.equal(cc.rawStatus, 'Processing');
  });
});

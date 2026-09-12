'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { P2pService } = require('../p2p.service');
const { P2pAdminService } = require('../p2pAdmin.service');
const v = require('../p2p.validators');
const { ORDER_STATUS, SELL_STATUS, OFFER_STATUS, DISPUTE_STATUS } = require('../p2p.constants');

/**
 * Peer-to-peer trading, against a real PostgreSQL and the real wallet.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * Every test below is a legacy defect written down as the money it moved.
 * The module was never mounted, so none of them was ever exploited — but all
 * of them were reachable the moment someone added the `require`.
 *
 * The five that cost money:
 *
 *   1. release had no row lock — two concurrent calls both credited
 *   2. sell-cancel checked only for RELEASED — cancelling twice refunded twice
 *   3. the sell balance check was a float compare in a separate statement
 *   4. `UPDATE credits SET ${order.coin}` — a request value as a column name
 *   5. no ledger row for any of it
 *
 * These run on the schema migration 009 RECONSTRUCTED from the legacy queries,
 * so they are also the first real exercise of that schema: a wrong type or a
 * missing constraint shows up here as a failing money movement.
 * ═════════════════════════════════════════════════════════════════════════
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 920_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

/** A real PNG signature — the content check reads bytes, not names. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(300, 0x11),
]);

const asFile = (buffer = PNG, originalname = 'proof.png', mimetype = 'image/png') => ({
  buffer,
  originalname,
  mimetype,
  size: buffer.length,
});

test('p2p', async (t) => {
  const logger = createLogger({ name: 'p2p-test', level: 'silent' });

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

  const { models } = connection;
  const users = [];
  const offers = [];

  // Rows before the connection — node:test runs `after` hooks in registration
  // order, so closing first would strand every cleanup below it.
  t.after(async () => {
    const ids = users.map(String);
    if (ids.length) {
      await models.P2pDispute.destroy({ where: { user_id: ids } });
      await models.P2pOrderSell.destroy({ where: { user_id: ids } });
      await models.P2pOrder.destroy({ where: { user_id: ids } });
      // `credits_ledger.user_id` is TEXT; an integer here is a Postgres type error.
      await models.CreditsLedger.destroy({ where: { user_id: ids } });
      await models.Credits.destroy({ where: { uid: users } });
      await models.Users.destroy({ where: { id: users } });
    }
    if (offers.length) {
      await models.P2pOfferPayment.destroy({ where: { offer_id: offers } });
      await models.P2pOffer.destroy({ where: { id: offers } });
    }
  });
  t.after(async () => {
    if (connection) await connection.close();
  });

  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'user-service' } };
  const service = new P2pService(deps);
  const admin = new P2pAdminService(deps);
  const STAFF = { id: 7001 };

  const seedPlayer = async (usdt = '1000') => {
    const id = newUid();
    users.push(id);
    await models.Users.create({ id, name: `p2p${id}`, password: 'x', status: 'active' });
    await models.Credits.create({ uid: id, usdt, inr: '0' });
    return id;
  };

  const balanceOf = async (uid) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.usdt ?? '0'));
  };

  /** A payment rail and an account, created once for every offer to hang off. */
  let paymentTypeId;
  let paymentAccountId;

  await t.test('setup: a payment rail and an account', async () => {
    const code = `t${process.pid}`.slice(0, 20);
    const existing = await models.P2pPaymentType.findOne({ where: { code }, raw: true });

    const type = existing ?? (await admin.createPaymentType({ staff: STAFF, name: 'Test Rail', code }));
    paymentTypeId = type.id;

    const account = await admin.createPaymentAccount({
      staff: STAFF,
      paymentTypeId,
      accountName: 'House',
      accountNumber: '000111222',
    });
    paymentAccountId = account.id;

    assert.ok(paymentAccountId);
  });

  const makeOffer = async (overrides = {}) => {
    const offer = await admin.createOffer({
      staff: STAFF,
      username: 'housetrader',
      coin: 'USDT',
      fiat: 'INR',
      price: '90',
      availableAmount: '1000',
      paymentAccountIds: [paymentAccountId],
      ...overrides,
    });
    offers.push(offer.id);
    return offer;
  };

  // ══════════════════════════════════════════════════════════════════════
  // 1. RELEASE: the double credit
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a buy order pays out exactly once, however many times release is called', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();

    const order = await service.createOrder({
      userId,
      offerId: offer.id,
      cryptoAmount: '10',
      paymentAccountId,
    });
    await service.markPaid({ userId, orderId: order.id, utrNumber: 'UTR12345', file: asFile() });

    await admin.releaseOrder({ staff: STAFF, orderId: order.id });
    assert.strictEqual(Number(await balanceOf(userId)), 10, 'credited once');

    /**
     * Legacy read the row, checked PAID and credited with no row lock. This is
     * the sequential version of that race: the second call must be refused.
     */
    await assert.rejects(
      () => admin.releaseOrder({ staff: STAFF, orderId: order.id }),
      (error) => error.code === 'P2P_ORDER_ALREADY_SETTLED'
    );

    assert.strictEqual(Number(await balanceOf(userId)), 10, 'still credited once');
  });

  await t.test('two concurrent releases credit once', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();

    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '25', paymentAccountId });
    await service.markPaid({ userId, orderId: order.id, utrNumber: 'UTR2', file: asFile() });

    /**
     * The actual race. `FOR UPDATE` serialises them: the second transaction
     * blocks until the first commits, then reads RELEASED and refuses.
     */
    const results = await Promise.allSettled([
      admin.releaseOrder({ staff: STAFF, orderId: order.id }),
      admin.releaseOrder({ staff: STAFF, orderId: order.id }),
    ]);

    const settled = results.filter((r) => r.status === 'fulfilled');
    assert.strictEqual(settled.length, 1, 'exactly one release succeeded');
    assert.strictEqual(Number(await balanceOf(userId)), 25);
  });

  await t.test('release records who authorised it and writes a ledger row', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();

    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '5', paymentAccountId });
    await service.markPaid({ userId, orderId: order.id, utrNumber: 'UTR3', file: asFile() });
    await admin.releaseOrder({ staff: STAFF, orderId: order.id, note: 'proof checked' });

    const row = await models.P2pOrder.findByPk(order.id, { raw: true });
    // The column did not exist in legacy — the route had no authentication, so
    // there was no operator to record.
    assert.strictEqual(String(row.released_by), String(STAFF.id));
    assert.strictEqual(row.admin_note, 'proof checked');

    const ledger = await models.CreditsLedger.findAll({ where: { user_id: String(userId) }, raw: true });
    // Legacy moved money with a bare UPDATE and wrote nothing here.
    assert.ok(ledger.length >= 1, 'the movement is in the ledger');
  });

  await t.test('an order that was never marked paid cannot be released', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();
    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '5', paymentAccountId });

    await assert.rejects(
      () => admin.releaseOrder({ staff: STAFF, orderId: order.id }),
      (error) => error.code === 'P2P_ORDER_NOT_PAID'
    );
    assert.strictEqual(Number(await balanceOf(userId)), 0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 2. SELL-CANCEL: the double refund
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the crypto leaves the wallet when a sell order opens', async () => {
    const userId = await seedPlayer('500');
    const offer = await makeOffer();

    await service.createSellOrder({
      userId,
      offerId: offer.id,
      cryptoAmount: '100',
      paymentTypeId,
      accountNumber: '99887766',
      file: asFile(),
    });

    assert.strictEqual(Number(await balanceOf(userId)), 400);
  });

  await t.test('cancelling a sell order refunds exactly once', async () => {
    const userId = await seedPlayer('500');
    const offer = await makeOffer();

    const sell = await service.createSellOrder({
      userId,
      offerId: offer.id,
      cryptoAmount: '100',
      paymentTypeId,
      accountNumber: '99887766',
      file: asFile(),
    });
    assert.strictEqual(Number(await balanceOf(userId)), 400);

    await admin.cancelSellOrder({ staff: STAFF, orderId: sell.id });
    assert.strictEqual(Number(await balanceOf(userId)), 500, 'refunded');

    /**
     * THE DEFECT. Legacy checked only `status === 'RELEASED'`, so a CANCELLED
     * order passed the check and refunded again — as many times as called, on a
     * route with no authentication.
     */
    await assert.rejects(
      () => admin.cancelSellOrder({ staff: STAFF, orderId: sell.id }),
      (error) => error.code === 'P2P_ORDER_ALREADY_SETTLED'
    );

    assert.strictEqual(Number(await balanceOf(userId)), 500, 'still 500, not 600');
  });

  await t.test('a released sell order cannot then be cancelled into a refund', async () => {
    const userId = await seedPlayer('500');
    const offer = await makeOffer();

    const sell = await service.createSellOrder({
      userId,
      offerId: offer.id,
      cryptoAmount: '50',
      paymentTypeId,
      accountNumber: '1',
      file: asFile(),
    });

    await admin.releaseSellOrder({ staff: STAFF, orderId: sell.id, file: asFile() });

    await assert.rejects(
      () => admin.cancelSellOrder({ staff: STAFF, orderId: sell.id }),
      (error) => error.code === 'P2P_ORDER_ALREADY_SETTLED'
    );

    // The operator has paid the fiat out; refunding the crypto too would be
    // paying for the same trade twice.
    assert.strictEqual(Number(await balanceOf(userId)), 450);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 3. THE BALANCE CHECK
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a sell order larger than the balance is refused, and nothing is written', async () => {
    const userId = await seedPlayer('10');
    const offer = await makeOffer();

    await assert.rejects(
      () =>
        service.createSellOrder({
          userId,
          offerId: offer.id,
          cryptoAmount: '100',
          paymentTypeId,
          accountNumber: '1',
          file: asFile(),
        }),
      (error) => error.code === 'P2P_INSUFFICIENT_BALANCE'
    );

    assert.strictEqual(Number(await balanceOf(userId)), 10);
    // The row was written before the debit, so this proves the rollback.
    assert.strictEqual(await models.P2pOrderSell.count({ where: { user_id: String(userId) } }), 0);
  });

  await t.test('two concurrent sell orders cannot both spend the same balance', async () => {
    const userId = await seedPlayer('100');
    const offer = await makeOffer();

    const open = () =>
      service.createSellOrder({
        userId,
        offerId: offer.id,
        cryptoAmount: '80',
        paymentTypeId,
        accountNumber: '1',
        file: asFile(),
      });

    /**
     * Legacy did `SELECT balance` → compare in JS → `UPDATE credits SET … - $1`.
     * Both requests read 100, both saw 100 >= 80, both debited: balance −60.
     * The wallet's guarded UPDATE decides this in Postgres instead.
     */
    const results = await Promise.allSettled([open(), open()]);
    const ok = results.filter((r) => r.status === 'fulfilled');

    assert.strictEqual(ok.length, 1, 'only one order opened');
    assert.strictEqual(Number(await balanceOf(userId)), 20, 'never negative');
  });

  // ══════════════════════════════════════════════════════════════════════
  // 4. THE COLUMN-NAME INJECTION
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an offer cannot name a coin that is not a real currency', () => {
    /**
     * `order.coin` reached SQL as a column name:
     *
     *     UPDATE credits SET ${order.coin} = ${order.coin} + $1
     *
     * and it came from this body. An enum here means the value cannot be a SQL
     * fragment; the wallet resolving the column means it never reaches SQL at
     * all, which is the part that actually closes it.
     */
    const attack = { ...validOfferBody(), coin: 'usdt = usdt + 1000000, inr' };
    assert.strictEqual(v.createOffer.body.safeParse(attack).success, false);

    // And a plain unknown currency is refused the same way.
    assert.strictEqual(v.createOffer.body.safeParse({ ...validOfferBody(), coin: 'DOGE' }).success, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 5. OWNERSHIP — the id came from the body or the path
  // ══════════════════════════════════════════════════════════════════════

  await t.test('no user shape can name an account', () => {
    for (const [name, shape] of [
      ['createOrder', v.createOrder.body],
      ['createSellOrder', v.createSellOrder.body],
      ['markPaid', v.markPaid.body],
      ['createDispute', v.createDispute.body],
    ]) {
      const parsed = shape.safeParse({ user_id: '1', userId: 1, offerId: 1, cryptoAmount: '1', paymentAccountId: 1 });
      assert.strictEqual(parsed.success, false, `${name} must reject a caller-supplied account`);
    }
  });

  await t.test("a player cannot read another player's order", async () => {
    const owner = await seedPlayer('0');
    const stranger = await seedPlayer('0');
    const offer = await makeOffer();

    const order = await service.createOrder({ userId: owner, offerId: offer.id, cryptoAmount: '5', paymentAccountId });

    await assert.rejects(
      () => service.orderDetails({ userId: stranger, orderId: order.id }),
      (error) => error.code === 'P2P_ORDER_NOT_FOUND',
      'and "not yours" reads the same as "does not exist"'
    );
  });

  await t.test("a player cannot mark another player's order paid", async () => {
    const owner = await seedPlayer('0');
    const stranger = await seedPlayer('0');
    const offer = await makeOffer();

    const order = await service.createOrder({ userId: owner, offerId: offer.id, cryptoAmount: '5', paymentAccountId });

    await assert.rejects(
      () => service.markPaid({ userId: stranger, orderId: order.id, utrNumber: 'X1234', file: asFile() }),
      (error) => error.code === 'P2P_ORDER_NOT_FOUND'
    );
  });

  await t.test('a listing returns only the caller’s own orders', async () => {
    const mine = await seedPlayer('0');
    const theirs = await seedPlayer('0');
    const offer = await makeOffer();

    await service.createOrder({ userId: mine, offerId: offer.id, cryptoAmount: '5', paymentAccountId });
    await service.createOrder({ userId: theirs, offerId: offer.id, cryptoAmount: '5', paymentAccountId });

    const result = await service.myOrders({ userId: mine });
    assert.strictEqual(result.count, 1);
  });

  // ══════════════════════════════════════════════════════════════════════
  // The offer's remaining amount
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an order holds against the offer, and cancelling gives it back', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer({ availableAmount: '100' });

    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '40', paymentAccountId });

    // Legacy wrote `available_amount` once at creation and never touched it, so
    // one offer for 100 could back a hundred orders for 100.
    let row = await models.P2pOffer.findByPk(offer.id, { raw: true });
    assert.strictEqual(Number(row.available_amount), 60);

    await admin.cancelOrder({ staff: STAFF, orderId: order.id });
    row = await models.P2pOffer.findByPk(offer.id, { raw: true });
    assert.strictEqual(Number(row.available_amount), 100);
  });

  await t.test('an offer cannot back more than it has', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer({ availableAmount: '30' });

    await assert.rejects(
      () => service.createOrder({ userId, offerId: offer.id, cryptoAmount: '50', paymentAccountId }),
      (error) => error.code === 'P2P_OFFER_EXHAUSTED'
    );
  });

  await t.test('a paused offer takes no new orders', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();

    // Legacy had no way to take an offer down: `status` was written at creation
    // and no route ever changed it.
    await admin.setOfferStatus({ staff: STAFF, offerId: offer.id, status: OFFER_STATUS.PAUSED });

    await assert.rejects(
      () => service.createOrder({ userId, offerId: offer.id, cryptoAmount: '5', paymentAccountId }),
      (error) => error.code === 'P2P_OFFER_INACTIVE'
    );
  });

  await t.test('a payment account that is not on the offer is refused', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();

    const other = await admin.createPaymentAccount({
      staff: STAFF,
      paymentTypeId,
      accountName: 'Elsewhere',
      accountNumber: '555',
    });

    // Legacy stored whatever id the body named, so a buyer could be shown — and
    // pay — an account with no relationship to the trade.
    await assert.rejects(
      () => service.createOrder({ userId, offerId: offer.id, cryptoAmount: '5', paymentAccountId: other.id }),
      (error) => error.code === 'P2P_ACCOUNT_NOT_ON_OFFER'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  // Expiry, proofs and disputes
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an expired order cannot be paid, and releases its hold', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer({ availableAmount: '100' });

    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '20', paymentAccountId });

    // Legacy computed a countdown for the client and no handler ever compared
    // `expires_at` to the clock — the timer was decoration.
    await models.P2pOrder.update({ expires_at: new Date(Date.now() - 60_000) }, { where: { id: order.id } });

    await assert.rejects(
      () => service.markPaid({ userId, orderId: order.id, utrNumber: 'LATE1', file: asFile() }),
      (error) => error.code === 'P2P_ORDER_EXPIRED'
    );

    const row = await models.P2pOrder.findByPk(order.id, { raw: true });
    assert.strictEqual(row.status, ORDER_STATUS.EXPIRED);

    const offerRow = await models.P2pOffer.findByPk(offer.id, { raw: true });
    assert.strictEqual(Number(offerRow.available_amount), 100, 'the hold went back');
  });

  await t.test('a payment proof is required and is judged on its bytes', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();
    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '5', paymentAccountId });

    // Legacy accepted `req.file` as optional and wrote null — leaving an order
    // in PAID that an operator had to release on trust.
    await assert.rejects(
      () => service.markPaid({ userId, orderId: order.id, utrNumber: 'NOPROOF' }),
      (error) => error.code === 'P2P_NO_FILE'
    );

    // And the format is read, not declared. `middleware.js` had no fileFilter
    // at all — any file, any name, straight to disk.
    await assert.rejects(
      () =>
        service.markPaid({
          userId,
          orderId: order.id,
          utrNumber: 'HTML1',
          file: asFile(Buffer.from('<script>x</script>'.padEnd(300, ' ')), 'proof.png', 'image/png'),
        }),
      (error) => error.code === 'P2P_NOT_AN_IMAGE'
    );
  });

  await t.test('a proof is stored in the row and served with its detected type', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();
    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '5', paymentAccountId });
    await service.markPaid({ userId, orderId: order.id, utrNumber: 'UTRIMG', file: asFile() });

    const image = await service.proofImage({ userId, kind: 'order', id: order.id });
    assert.strictEqual(image.contentType, 'image/png');
    assert.ok(image.data.equals(PNG));
  });

  await t.test("a player cannot fetch another player's proof", async () => {
    const owner = await seedPlayer('0');
    const stranger = await seedPlayer('0');
    const offer = await makeOffer();
    const order = await service.createOrder({ userId: owner, offerId: offer.id, cryptoAmount: '5', paymentAccountId });
    await service.markPaid({ userId: owner, orderId: order.id, utrNumber: 'UTRP', file: asFile() });

    // Legacy served these from a static mount by filename — anyone who could
    // guess one read another player's bank screenshot.
    await assert.rejects(
      () => service.proofImage({ userId: stranger, kind: 'order', id: order.id }),
      (error) => error.code === 'P2P_ORDER_NOT_FOUND'
    );
  });

  await t.test('a dispute can be filed once and flags the order', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();
    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '5', paymentAccountId });
    await service.markPaid({ userId, orderId: order.id, utrNumber: 'UTRD', file: asFile() });

    const dispute = await service.createDispute({
      userId,
      orderId: order.id,
      orderType: 'BUY',
      reason: 'not_released',
      file: asFile(),
    });

    assert.strictEqual(dispute.status, DISPUTE_STATUS.OPEN);

    // Legacy left the order where it was, so an operator could release it
    // without ever seeing the dispute.
    const row = await models.P2pOrder.findByPk(order.id, { raw: true });
    assert.strictEqual(row.status, 'DISPUTED');

    // And `createDispute` INSERTed unconditionally, so a retry filed a second.
    await assert.rejects(
      () => service.createDispute({ userId, orderId: order.id, orderType: 'BUY', reason: 'again' }),
      (error) => error.code === 'P2P_DISPUTE_EXISTS'
    );
  });

  await t.test('resolving a dispute does not pay anyone', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer();
    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '15', paymentAccountId });
    await service.markPaid({ userId, orderId: order.id, utrNumber: 'UTRR', file: asFile() });

    const dispute = await service.createDispute({ userId, orderId: order.id, orderType: 'BUY', reason: 'slow' });
    await admin.setDisputeStatus({
      staff: STAFF,
      disputeId: dispute.id,
      status: DISPUTE_STATUS.RESOLVED,
      adminNote: 'operator checked',
    });

    /**
     * Deciding a dispute and paying out are separate acts. Conflating them is
     * how a resolution becomes a credit nobody reviewed.
     */
    assert.strictEqual(Number(await balanceOf(userId)), 0);

    const row = await models.P2pOrder.findByPk(order.id, { raw: true });
    assert.strictEqual(row.status, ORDER_STATUS.PAID, 'back where it was, ready to settle');
  });

  // ══════════════════════════════════════════════════════════════════════
  // Status writes and arithmetic
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the status endpoint cannot set an order to RELEASED', () => {
    /**
     * `updateOrderStatus` wrote any string to the column. `status` is what
     * every guard in this module reads — so that route could mark an order
     * RELEASED without paying anyone, or set a released one back to PENDING so
     * it could be released again.
     */
    for (const status of ['RELEASED', 'PENDING', 'PAID', 'CANCELLED', "'; DROP TABLE p2p_orders; --"]) {
      assert.strictEqual(
        v.updateOrderStatus.body.safeParse({ status }).success,
        false,
        `${status} must not be settable directly`
      );
    }

    assert.strictEqual(v.updateOrderStatus.body.safeParse({ status: 'DISPUTED' }).success, true);
  });

  await t.test('the fiat amount is exact decimal arithmetic', async () => {
    const userId = await seedPlayer('0');
    // A price that loses precision in IEEE-754: 0.1 × 3 is 0.30000000000000004.
    const offer = await makeOffer({ price: '0.1' });

    const order = await service.createOrder({ userId, offerId: offer.id, cryptoAmount: '3', paymentAccountId });

    // Legacy did `crypto_amount * offer.price` in doubles and wrote the product
    // to a NUMERIC(30,8).
    assert.strictEqual(Number(order.fiatAmount), 0.3);
  });

  await t.test('an order number does not collide', async () => {
    const userId = await seedPlayer('0');
    const offer = await makeOffer({ availableAmount: '1000' });

    /**
     * Legacy: `'P2P' + Date.now() + Math.floor(Math.random() * 1000)` against a
     * UNIQUE column — a thousand suffixes per millisecond, and a collision was
     * a 500 carrying a constraint name.
     */
    const made = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.createOrder({ userId, offerId: offer.id, cryptoAmount: '1', paymentAccountId })
      )
    );

    assert.strictEqual(new Set(made.map((o) => o.orderNo)).size, 10);
    for (const order of made) assert.ok(!/^P2P\d{13}/.test(order.orderNo), 'no timestamp in the number');
  });

  await t.test('the offer list hides exhausted and inactive offers', async () => {
    const offer = await makeOffer({ availableAmount: '1000' });
    await models.P2pOffer.update({ available_amount: '0' }, { where: { id: offer.id } });

    const result = await service.offers({ limit: 100 });
    assert.ok(!result.rows.some((row) => row.id === offer.id));
  });

  function validOfferBody() {
    return {
      coin: 'USDT',
      fiat: 'INR',
      price: '90',
      availableAmount: '100',
      username: 'x',
      paymentAccountIds: [1],
    };
  }
});

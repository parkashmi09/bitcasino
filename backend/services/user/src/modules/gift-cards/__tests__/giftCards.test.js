'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { GiftCardsService } = require('../giftCards.service');

/**
 * Gift cards, and the race that paid twice.
 *
 * The legacy claim handler read the row, checked its status, and only then
 * opened a transaction to credit the wallet — so the check and the write were
 * not atomic and two simultaneous claims both paid. With `userId` coming from
 * the request body on an unauthenticated route, firing two was trivial.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 960_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const newKey = () => `GC-${process.pid}-${(seq += 1)}`;

test('gift cards', async (t) => {
  const logger = createLogger({ name: 'gift-cards-test', level: 'silent' });

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

  await connection.models.Exchangerate.findOrCreate({
    where: { currency: 'INR' },
    defaults: { currency: 'INR', usd_rate: '0.012' },
  });

  /** Turnover answers, per service. `null` makes that service unreachable. */
  const build = ({ casinoTurnover = {}, sportsUsd = '0', casinoDown = false, sportsDown = false } = {}) =>
    new GiftCardsService({
      models: connection.models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'user-service' },
      clients: {
        casino: {
          get: async () => {
            if (casinoDown) throw new Error('casino unreachable');
            return { bets: 1, byCurrency: casinoTurnover };
          },
        },
        sports: {
          get: async () => {
            if (sportsDown) throw new Error('sports unreachable');
            return { bets: 1, usd: sportsUsd };
          },
        },
        admin: { get: async () => ({}) },
      },
    });

  const seed = async (uid, usdt = '0') => {
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({ id: uid, name: `gc-${uid}`, password: 'x', status: 'active' });
    await connection.models.Credits.create({ uid, usdt });
  };

  const balanceOf = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.usdt ?? '0'));
  };

  const makeCard = async (service, overrides = {}) =>
    service.create({ uniqueKey: newKey(), amount: '25', allUsers: true, isActive: true, ...overrides });

  // ══════════════════════════════════════════════════════════════════════
  //  The race
  // ══════════════════════════════════════════════════════════════════════

  await t.test('two simultaneous claims pay ONCE — legacy paid twice', async () => {
    const service = build();
    const uid = newUid();
    await seed(uid);
    const card = await makeCard(service);

    await service.activate({ userId: uid, giftCardId: card.id });

    const results = await Promise.allSettled([
      service.claim({ userId: uid, giftCardId: card.id }),
      service.claim({ userId: uid, giftCardId: card.id }),
    ]);

    const paid = results.filter((r) => r.status === 'fulfilled');
    assert.equal(paid.length, 1, 'exactly one claim may succeed');
    assert.equal(await balanceOf(uid), '25.00000000');

    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 1);
  });

  await t.test('claiming twice in sequence is refused', async () => {
    const service = build();
    const uid = newUid();
    await seed(uid);
    const card = await makeCard(service);

    await service.activate({ userId: uid, giftCardId: card.id });
    await service.claim({ userId: uid, giftCardId: card.id });

    await assert.rejects(
      () => service.claim({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_ALREADY_CLAIMED'
    );
    assert.equal(await balanceOf(uid), '25.00000000');
  });

  await t.test('a card that was never activated cannot be claimed', async () => {
    const service = build();
    const uid = newUid();
    await seed(uid);
    const card = await makeCard(service);

    await assert.rejects(
      () => service.claim({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_NOT_ACTIVATED'
    );
    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('a claim lands on the player statement — legacy wrote no ledger row', async () => {
    const service = build();
    const uid = newUid();
    await seed(uid);
    const card = await makeCard(service, { amount: '40' });

    await service.activate({ userId: uid, giftCardId: card.id });
    await service.claim({ userId: uid, giftCardId: card.id });

    const ledger = await connection.models.CreditsLedger.findAll({ where: { user_id: String(uid) }, raw: true });
    assert.equal(ledger.length, 1);
    assert.equal(money.toDecimalString(money.toMinor(ledger[0].amount)), '40.00000000');
    assert.equal(ledger[0].reason, 'BONUS');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Conditions
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a wagering condition blocks the claim until it is met', async () => {
    const uid = newUid();
    await seed(uid);

    const service = build({ sportsUsd: '10' });
    const card = await makeCard(service, { wagerRequired: true, wagerTimes: 100 });
    await service.activate({ userId: uid, giftCardId: card.id });

    await assert.rejects(
      () => service.claim({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_WAGER_CONDITION_UNMET'
    );
    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('casino and sports turnover ADD UP towards the requirement', async () => {
    const uid = newUid();
    await seed(uid);

    // 60 USD of sports + 5000 INR of casino at 0.012 = 60 USD → 120 total.
    const service = build({ sportsUsd: '60', casinoTurnover: { INR: '5000' } });
    const card = await makeCard(service, { wagerRequired: true, wagerTimes: 100 });
    await service.activate({ userId: uid, giftCardId: card.id });

    const result = await service.claim({ userId: uid, giftCardId: card.id });
    assert.equal(result.status, 'Claimed');
    assert.equal(await balanceOf(uid), '25.00000000');
  });

  await t.test('an unreachable wagering service does NOT pay out', async () => {
    // The total would be an undercount, so "not yet" is the safe answer. Paying
    // on incomplete data cannot be undone; making the player wait can.
    const uid = newUid();
    await seed(uid);

    const service = build({ sportsUsd: '99999', casinoDown: true });
    const card = await makeCard(service, { wagerRequired: true, wagerTimes: 10 });
    await service.activate({ userId: uid, giftCardId: card.id });

    await assert.rejects(
      () => service.claim({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_WAGER_CONDITION_UNMET'
    );
    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('a deposit condition needs ONE qualifying deposit, not a total', async () => {
    const uid = newUid();
    await seed(uid);
    const service = build();

    const card = await makeCard(service, { depositRequired: true, depositAmount: '100' });
    await service.activate({ userId: uid, giftCardId: card.id });

    // Two 60-USDT deposits total 120, but neither one clears 100.
    for (let i = 0; i < 2; i += 1) {
      await connection.models.Ccdeposit.create({
        userid: String(uid), amount: '60', status: 'Success', chain: 'TRX', orderid: `${newKey()}-${i}`,
      });
    }

    await assert.rejects(
      () => service.claim({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_DEPOSIT_CONDITION_UNMET'
    );

    // One that does clear it.
    await connection.models.Ccdeposit.create({
      userid: String(uid), amount: '150', status: 'Success', chain: 'TRX', orderid: newKey(),
    });

    const result = await service.claim({ userId: uid, giftCardId: card.id });
    assert.equal(result.status, 'Claimed');
  });

  await t.test('a deposit made in the same instant as the claim still counts', async () => {
    // An open-ended card's conditions run until it is claimed. Clamping the
    // window to `< now` at claim time excluded a deposit made in the same
    // millisecond — which is exactly what a player does when they deposit and
    // immediately press claim.
    const uid = newUid();
    await seed(uid);
    const service = build();

    const card = await makeCard(service, { depositRequired: true, depositAmount: '100' });
    await service.activate({ userId: uid, giftCardId: card.id });
    await connection.models.Ccdeposit.create({
      userid: String(uid), amount: '100', status: 'Success', chain: 'TRX', orderid: newKey(),
    });

    const result = await service.claim({ userId: uid, giftCardId: card.id });
    assert.equal(result.status, 'Claimed');
  });

  await t.test('a period_days card stops counting when the period ends', async () => {
    const uid = newUid();
    await seed(uid);
    const service = build();

    const card = await makeCard(service, { depositRequired: true, depositAmount: '100', periodDays: 7 });
    await service.activate({ userId: uid, giftCardId: card.id });

    // Backdate the activation so its 7-day window has already closed, then
    // deposit now — after the window.
    await connection.models.UserGiftCards.update(
      { start_date: new Date(Date.now() - 30 * 86_400_000) },
      { where: { user_id: uid, gift_card_id: card.id } }
    );
    await connection.models.Ccdeposit.create({
      userid: String(uid), amount: '500', status: 'Success', chain: 'TRX', orderid: newKey(),
    });

    await assert.rejects(
      () => service.claim({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_DEPOSIT_CONDITION_UNMET'
    );
  });

  await t.test('a deposit made BEFORE activation does not count', async () => {
    const uid = newUid();
    await seed(uid);
    const service = build();

    await connection.models.Ccdeposit.create({
      userid: String(uid), amount: '500', status: 'Success', chain: 'TRX', orderid: newKey(),
      created_at: new Date(Date.now() - 86_400_000),
    });

    const card = await makeCard(service, { depositRequired: true, depositAmount: '100' });
    await service.activate({ userId: uid, giftCardId: card.id });

    await assert.rejects(
      () => service.claim({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_DEPOSIT_CONDITION_UNMET'
    );
  });

  await t.test('a failed deposit does not qualify', async () => {
    const uid = newUid();
    await seed(uid);
    const service = build();

    const card = await makeCard(service, { depositRequired: true, depositAmount: '50' });
    await service.activate({ userId: uid, giftCardId: card.id });

    await connection.models.Ccdeposit.create({
      userid: String(uid), amount: '500', status: 'Failed', chain: 'TRX', orderid: newKey(),
    });

    await assert.rejects(
      () => service.claim({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_DEPOSIT_CONDITION_UNMET'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Eligibility and lifecycle
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a targeted card cannot be activated by an unassigned player', async () => {
    const service = build();
    const uid = newUid();
    await seed(uid);
    const card = await makeCard(service, { allUsers: false });

    await assert.rejects(
      () => service.activate({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_NOT_ELIGIBLE'
    );
  });

  await t.test('an inactive card cannot be activated', async () => {
    const service = build();
    const uid = newUid();
    await seed(uid);
    const card = await makeCard(service, { isActive: false });

    await assert.rejects(
      () => service.activate({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_INACTIVE'
    );
  });

  await t.test('activating twice is refused rather than restarting the clock', async () => {
    // Otherwise a player whose period was about to expire could re-activate and
    // get a fresh window on the same card, indefinitely.
    const service = build();
    const uid = newUid();
    await seed(uid);
    const card = await makeCard(service);

    await service.activate({ userId: uid, giftCardId: card.id });
    await assert.rejects(
      () => service.activate({ userId: uid, giftCardId: card.id }),
      (err) => err.code === 'GIFTCARD_ALREADY_ACTIVATED'
    );
  });

  await t.test('a card with activations cannot be deleted', async () => {
    const service = build();
    const uid = newUid();
    await seed(uid);
    const card = await makeCard(service);
    await service.activate({ userId: uid, giftCardId: card.id });

    await assert.rejects(
      () => service.remove({ id: card.id }),
      (err) => err.code === 'GIFTCARD_IN_USE'
    );
  });

  await t.test('a condition switched on with no figure is refused at creation', async () => {
    // Otherwise it is trivially satisfied, and a "deposit $100 first" card
    // becomes free money.
    const { create } = require('../giftCards.validators');
    const result = create.body.safeParse({
      uniqueKey: 'X', amount: '10', depositRequired: true, wagerRequired: false, allUsers: true, isActive: true,
    });
    assert.equal(result.success, false);
  });

  await t.test('a player only sees cards open to them', async () => {
    const service = build();
    const owner = newUid();
    const other = newUid();
    await seed(owner);
    await seed(other);

    const targeted = await makeCard(service, { allUsers: false });
    await connection.models.UserGiftCards.create({
      user_id: owner, gift_card_id: targeted.id, status: 'Available', start_date: new Date(),
    });

    const ownerSees = await service.listForUser({ userId: owner });
    const otherSees = await service.listForUser({ userId: other });

    assert.ok(ownerSees.some((c) => c.giftcards.id === targeted.id));
    assert.ok(
      !otherSees.some((c) => c.giftcards.id === targeted.id),
      'a targeted card must not be visible to others'
    );
  });

  await t.test('the listing carries the card, the activation and both conditions', async () => {
    const service = build();
    const userId = newUid();
    await seed(userId);

    const card = await makeCard(service, { allUsers: true, depositRequired: true, depositAmount: '20', wagerRequired: true, wagerTimes: 2 });
    const [row] = (await service.listForUser({ userId })).filter((c) => c.giftcards.id === card.id);

    assert.ok(row, 'the card should be listed');
    assert.equal(row.usergiftcards, null, 'an untaken card has no activation row');

    // Numbers, not decimal strings: the page multiplies and sums these, and a
    // string turns `total + amount` into concatenation.
    assert.equal(typeof row.giftcards.amount, 'number');
    assert.equal(typeof row.giftcards.depositAmount, 'number');
    assert.equal(row.giftcards.depositStatus, true);
    assert.equal(row.giftcards.wagerStatus, true);

    assert.equal(typeof row.deposit.status, 'boolean');
    // deposit 20 × wagerTimes 2 — the same rule the claim enforces.
    assert.equal(row.wager.requiredWagerUSD, 40);
  });

  await t.test('an activated card reports its activation', async () => {
    const service = build();
    const userId = newUid();
    await seed(userId);

    const card = await makeCard(service, { allUsers: true });
    await service.activate({ userId, giftCardId: card.id });

    const [row] = (await service.listForUser({ userId })).filter((c) => c.giftcards.id === card.id);

    assert.equal(row.usergiftcards.status, 'Activated');
    assert.ok(row.usergiftcards.startDate, 'the clock started');
  });

  await t.test('a card with no conditions reads as satisfied, not as failed', async () => {
    // `false` here would render as the player having failed something the card
    // never asked of them.
    const service = build();
    const userId = newUid();
    await seed(userId);

    const card = await makeCard(service, { allUsers: true, depositRequired: false, wagerRequired: false, wagerTimes: 0 });
    const [row] = (await service.listForUser({ userId })).filter((c) => c.giftcards.id === card.id);

    assert.equal(row.deposit.status, true);
    assert.equal(row.wager.requiredWagerUSD, 0);
    assert.equal(row.wager.status, true);
  });
});

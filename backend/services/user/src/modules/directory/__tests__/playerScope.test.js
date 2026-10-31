'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { SwapService } = require('../../swap/swap.service');
const { BonusService } = require('../../bonus/bonus.service');
const { GiftCardsService } = require('../../gift-cards/giftCards.service');
const { VaultService } = require('../../vault/vault.service');
const { KycService } = require('../../kyc/kyc.service');
const { WagerService } = require('../../wager/wager.service');
const { SpinWheelService } = require('../../spin-wheel/spinWheel.service');

/**
 * Staff listings in user-service are scoped to the caller's tree.
 *
 * Confirmed live with an agent, a master and a super master: swap history,
 * redeem codes, gift card records and claim counts, vault users and stats and
 * KYC applications all listed players outside the caller's downline. Each now
 * asks the same question the directory and the wallet ask — admin-service's
 * `visibleStaffIds`, behind the descendants route — through
 * `directory/playerScope.js`.
 *
 * The admin client is stubbed with that route's answer; the rows are real.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextId = 960_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('staff listings are scoped to the caller’s tree', async (t) => {
  const logger = createLogger({ name: 'player-scope-test', level: 'silent' });

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
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models, sequelize } = connection;
  const q = (sql, replacements) => sequelize.query(sql, { replacements });

  /**
   * agentA ── playerA
   * agentB ── playerB
   * ROOT (staff 1, the owner — and the back office, whose tree contains it)
   */
  const agentA = 9_700_000 + (process.pid % 10_000) * 2;
  const agentB = agentA + 1;
  const playerA = newId();
  const playerB = newId();
  const players = [playerA, playerB];

  const descendants = {
    [agentA]: [agentA],
    [agentB]: [agentB],
    1: [1, agentA, agentB],
  };
  const admin = {
    async get(url) {
      const staffId = Number(url.match(/staff\/(\d+)\/descendants/)?.[1]);
      return { staffId, ids: descendants[staffId] ?? [staffId] };
    },
  };

  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kyc-scope-'));
  const deps = {
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', VAULT_MINIMUM: '1', KYC_STORAGE_DIR: storageDir },
    clients: { admin },
  };

  const asA = { id: agentA };
  const asB = { id: agentB };
  const asAdmin = { id: 1 };

  let giftCardId;
  const kycIds = {};

  const cleanup = async () => {
    await models.SwapHistory.destroy({ where: { uid: players } });
    await models.Redeembonus.destroy({ where: { userid: players } });
    await models.UserGiftCards.destroy({ where: { user_id: players } });
    await q(`DELETE FROM vault_interest_history WHERE userid IN (:players)`, { players });
    await q(`DELETE FROM vault_pro WHERE userid IN (:players)`, { players });
    await models.UserKyc.destroy({ where: { user_id: players.map(String) } });
    await models.SpinWheelClaims.destroy({ where: { user_id: players } });
    await models.Users.destroy({ where: { id: players } });
    await q(`DELETE FROM staff WHERE id IN (:ids)`, { ids: [agentA, agentB] });
  };

  t.after(async () => {
    await cleanup();
    if (giftCardId) await models.GiftCards.destroy({ where: { id: giftCardId } });
    await fs.rm(storageDir, { recursive: true, force: true });
    await connection.close();
  });

  await cleanup();

  const [[role]] = await q(`SELECT id FROM roles WHERE level = 6 ORDER BY id LIMIT 1`);
  assert.ok(role, 'the test database needs a level-6 (agent) role');
  for (const id of [agentA, agentB]) {
    await q(
      `INSERT INTO staff (id, name, email, password, role_id) VALUES (:id, :name, :email, 'x', :role)`,
      { id, name: `scope-agent-${id}`, email: `scope-${id}@test.invalid`, role: role.id }
    );
  }

  await models.Users.bulkCreate([
    { id: playerA, name: `scope-a-${playerA}`, password: 'x', status: 'active', parent_staff_id: agentA },
    { id: playerB, name: `scope-b-${playerB}`, password: 'x', status: 'active', parent_staff_id: agentB },
  ]);

  const now = new Date();
  for (const uid of players) {
    await models.SwapHistory.create({
      uid, from_currency: 'INR', to_currency: 'USDT', from_amount: '100', to_amount: '1',
      fee_percentage: '0.15', fee_amount: '15', fee_currency: 'INR', usd_rate_from: '0.012', usd_rate_to: '1',
      created_at: now,
    });
    await models.Redeembonus.create({
      userid: uid, code: `SCOPE-${uid}`, amount: 10, status: 'active', createdat: now, updatedat: now,
    });
    await q(
      `INSERT INTO vault_pro (userid, "vaultBalance", coin, "createdAt", "updatedAt", "incomeDate", status)
       VALUES (:uid, 100, 'INR', NOW(), NOW(), NOW(), 'active')`,
      { uid }
    );
    await models.SpinWheelClaims.create({ user_id: uid, deposit_amount: '10', reward_amount: '1', claimed_at: now });
    await q(
      `INSERT INTO vault_interest_history (userid, coin, interest, rate, "createdAt") VALUES (:uid, 'INR', 1, 7.5, NOW())`,
      { uid }
    );
  }

  const card = await models.GiftCards.create({
    unique_key: `scope-card-${playerA}`, amount: '5', is_active: true, created_at: now, updated_at: now,
  });
  giftCardId = card.id;
  await models.UserGiftCards.bulkCreate(
    players.map((uid) => ({ user_id: uid, gift_card_id: giftCardId, status: 'activated', created_at: now, updated_at: now }))
  );

  for (const uid of players) {
    const file = `scope-${uid}.png`;
    await fs.writeFile(path.join(storageDir, file), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const row = await models.UserKyc.create({
      user_id: String(uid), first_name: `scope-${uid}`, status: 'Pending', id_front_path: file,
      created_at: now, updated_at: now,
    });
    kycIds[uid] = row.id;
  }

  const ours = (rows, key) => rows.map((r) => Number(r[key])).filter((id) => players.includes(id)).sort();
  const notFound = (err) => err.status === 404;

  // ══════════════════════════════════════════════════════════════════════

  await t.test('swap history: own tree only, and another tree’s player is a 404', async () => {
    const swap = new SwapService(deps);

    const mine = await swap.listAllHistory({ staff: asA, limit: 500, offset: 0 });
    assert.deepEqual(ours(mine.rows, 'uid'), [playerA]);

    // Naming an out-of-tree player in the filter finds nothing.
    const filtered = await swap.listAllHistory({ staff: asA, userId: playerB, limit: 50, offset: 0 });
    assert.equal(filtered.count, 0);

    const own = await swap.listUserHistoryForStaff({ staff: asA, userId: playerA, limit: 50, offset: 0 });
    assert.equal(own.count, 1);
    await assert.rejects(
      () => swap.listUserHistoryForStaff({ staff: asA, userId: playerB, limit: 50, offset: 0 }),
      notFound
    );

    const all = await swap.listAllHistory({ staff: asAdmin, limit: 500, offset: 0 });
    assert.deepEqual(ours(all.rows, 'uid'), players.slice().sort());
  });

  await t.test('redeem codes: own tree only; admin sees all', async () => {
    const bonus = new BonusService(deps);

    const mine = await bonus.listCodes({ staff: asA, limit: 500, offset: 0 });
    assert.deepEqual(ours(mine.rows, 'userId'), [playerA]);

    const theirs = await bonus.listCodes({ staff: asB, limit: 500, offset: 0 });
    assert.deepEqual(ours(theirs.rows, 'userId'), [playerB]);

    const filtered = await bonus.listCodes({ staff: asA, userId: playerB, limit: 50, offset: 0 });
    assert.equal(filtered.total, 0);

    const all = await bonus.listCodes({ staff: asAdmin, limit: 500, offset: 0 });
    assert.deepEqual(ours(all.rows, 'userId'), players.slice().sort());

    await assert.rejects(() => bonus.overviewForStaff({ staff: asA, userId: playerB }), notFound);
  });

  await t.test('gift card records and claim counts: own tree only; the cards stay visible', async () => {
    const gifts = new GiftCardsService(deps);

    const mine = await gifts.records({ staff: asA, limit: 500, offset: 0 });
    assert.deepEqual(ours(mine.rows, 'userId'), [playerA]);

    const all = await gifts.records({ staff: asAdmin, limit: 500, offset: 0 });
    assert.deepEqual(ours(all.rows, 'userId'), players.slice().sort());

    const cardOf = (analytics) => analytics.cards.find((c) => String(c.id) === String(giftCardId));

    const agentView = await gifts.analytics({ staff: asA });
    assert.ok(cardOf(agentView), 'the card definition is site config, visible to everyone');
    assert.equal(cardOf(agentView).activations, 1, 'only the agent’s own player is counted');

    const adminView = await gifts.analytics({ staff: asAdmin });
    assert.equal(cardOf(adminView).activations, 2);
  });

  await t.test('vault users, stats and interest: own tree only; admin sees all', async () => {
    const vault = new VaultService(deps);

    const users = await vault.listVaultUsers({ staff: asA, limit: 500, offset: 0 });
    assert.deepEqual(ours(users.rows, 'userid'), [playerA]);

    const interest = await vault.listAllInterest({ staff: asA, limit: 500, offset: 0 });
    assert.deepEqual(ours(interest.rows, 'userid'), [playerA]);

    // Only this test's players are in either tree, so the agent's stats are
    // exactly their one player.
    const stats = await vault.stats({ staff: asA });
    assert.equal(stats.totalUsers, 1);
    assert.equal(stats.totalBalance, 100);

    const allUsers = await vault.listVaultUsers({ staff: asAdmin, limit: 500, offset: 0 });
    assert.deepEqual(ours(allUsers.rows, 'userid'), players.slice().sort());
    assert.ok((await vault.stats({ staff: asAdmin })).totalUsers >= 2);
  });

  await t.test('KYC: agent-tree players are never in the queue (direct users only); documents stay tree-scoped', async () => {
    const kyc = new KycService(deps);

    // docs/KYC.md: the queue is direct users only, so an agent's players are listed to nobody.
    const mine = await kyc.listApplications({ staff: asA, limit: 500, offset: 0 });
    assert.deepEqual(ours(mine.rows, 'userId'), []);

    const all = await kyc.listApplications({ staff: asAdmin, limit: 500, offset: 0 });
    assert.deepEqual(ours(all.rows, 'userId'), []);

    // Reviewing one's own agent-tree player is refused too.
    await assert.rejects(() => kyc.review({ userId: playerA, status: 'Verified' }, asA), (err) => err.code === 'KYC_DIRECT_USERS_ONLY');

    // A document in the tree opens; one outside it is "not found".
    const doc = await kyc.readDocument({ kycId: kycIds[playerA], field: 'idFront', requesterId: agentA, isStaff: true });
    assert.ok(doc.buffer.length > 0);
    await assert.rejects(
      () => kyc.readDocument({ kycId: kycIds[playerB], field: 'idFront', requesterId: agentA, isStaff: true }),
      (err) => err.code === 'KYC_DOCUMENT_NOT_FOUND'
    );
    await kyc.readDocument({ kycId: kycIds[playerB], field: 'idFront', requesterId: 1, isStaff: true });

    // And a review of someone else's player is refused before anything changes.
    await assert.rejects(() => kyc.review({ userId: playerB, status: 'Verified' }, asA), notFound);
    const untouched = await models.UserKyc.findByPk(kycIds[playerB], { raw: true });
    assert.equal(untouched.status, 'Pending');
  });

  await t.test('wager targets: own tree only, and another tree’s player cannot be read or changed', async () => {
    const wager = new WagerService(deps);
    const search = 'scope-';

    const mine = await wager.listMultipliers({ staff: asA, search, channel: 'all', limit: 200, offset: 0 });
    assert.deepEqual(ours(mine.rows, 'userId'), [playerA]);

    const all = await wager.listMultipliers({ staff: asAdmin, search, channel: 'all', limit: 200, offset: 0 });
    assert.deepEqual(ours(all.rows, 'userId'), players.slice().sort());

    await wager.assertStaffMayAct(asA, playerA);
    await assert.rejects(() => wager.assertStaffMayAct(asA, playerB), notFound);
    await wager.assertStaffMayAct(asAdmin, playerB);
  });

  await t.test('spin-wheel claims: own tree only; admin sees all', async () => {
    const wheel = new SpinWheelService(deps);

    const mine = await wheel.listClaims({ staff: asA, limit: 500, offset: 0 });
    assert.deepEqual(ours(mine.rows, 'userId'), [playerA]);

    const filtered = await wheel.listClaims({ staff: asA, userId: playerB, limit: 50, offset: 0 });
    assert.equal(filtered.total, 0);

    const all = await wheel.listClaims({ staff: asAdmin, limit: 500, offset: 0 });
    assert.deepEqual(ours(all.rows, 'userId'), players.slice().sort());
  });

  await t.test('channel=agent keeps agent players, channel=direct drops them (Direct Users | Agent Users tabs)', async () => {
    // Dono test players agent ke neeche hain (parent_staff_id set) — direct tab me nahi aane chahiye.
    const opts = { staff: asAdmin, limit: 500, offset: 0 };
    const lists = [
      ['swap', (c) => new SwapService(deps).listAllHistory({ ...opts, channel: c }), 'uid'],
      ['redeem codes', (c) => new BonusService(deps).listCodes({ ...opts, channel: c }), 'userId'],
      ['gift cards', (c) => new GiftCardsService(deps).records({ ...opts, channel: c }), 'userId'],
      ['vault users', (c) => new VaultService(deps).listVaultUsers({ ...opts, channel: c }), 'userid'],
      ['spin claims', (c) => new SpinWheelService(deps).listClaims({ ...opts, channel: c }), 'userId'],
    ];
    for (const [name, list, key] of lists) {
      assert.deepEqual(ours((await list('agent')).rows, key), players.slice().sort(), `${name}: agent`);
      assert.deepEqual(ours((await list('direct')).rows, key), [], `${name}: direct`);
    }
    // KYC is for direct users only (docs/KYC.md): the queue is always the direct channel, so an agent player's row is never listed.
    for (const channel of ['agent', 'direct']) {
      assert.deepEqual(ours((await new KycService(deps).listApplications({ ...opts, channel })).rows, 'userId'), [], `kyc (varchar user_id): ${channel}`);
    }
  });

  await t.test('no caller is no rows, not every row', async () => {
    const swap = new SwapService(deps);
    const none = await swap.listAllHistory({ limit: 500, offset: 0 });
    assert.deepEqual(ours(none.rows, 'uid'), []);
  });
});

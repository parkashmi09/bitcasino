'use strict';

const test = require('node:test');
const assert = require('node:assert');

const express = require('express');
const db = require('@ibitplay/db');
const { createLogger, errorHandler, ForbiddenError } = require('@ibitplay/common');
const { hasAllPermissions } = require('@ibitplay/auth');

const { OriginalGamesAdminService } = require('../originalGames.service');

/** Who gets past the gate: the Super Admin side on originals:read, everyone below on reports:read. */
test('original games routes: who may read', async (t) => {
  const auth = {
    requirePermission: (...required) => (req, _res, next) =>
      hasAllPermissions(req.staff.permissions, required) ? next() : next(new ForbiddenError('forbidden')),
  };
  // No models: a request that gets past the gate fails in the service (500), one refused is 403.
  const router = require('../routes/admin.routes')({ auth, models: {} });
  const status = async (staff) => {
    const app = express();
    app.use((req, _res, next) => { req.staff = staff; next(); }, router, errorHandler({ logger: createLogger({ name: 'og-route-test', level: 'silent' }) }));
    const server = app.listen(0);
    try {
      return (await fetch(`http://127.0.0.1:${server.address().port}/games`)).status;
    } finally {
      server.close();
    }
  };

  await t.test('a Super Admin executive needs originals:read, reports:read is not enough', async () => {
    assert.equal(await status({ id: 1, level: 7, parentLevel: 1, permissions: ['reports:read'] }), 403);
    assert.notEqual(await status({ id: 1, level: 7, parentLevel: 1, permissions: ['originals:read'] }), 403);
  });

  await t.test('an agent gets in on reports:read only', async () => {
    assert.equal(await status({ id: 9, level: 6, permissions: ['originals:read'] }), 403);
    assert.notEqual(await status({ id: 9, level: 6, permissions: ['reports:read'] }), 403);
  });
});

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextId = 710_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

/** A staff below the Super Admin reads only its own downline's Original Games rounds. */
test('original games admin reads are scoped to the caller\'s tree', async (t) => {
  const logger = createLogger({ name: 'original-games-test', level: 'silent' });
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
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const service = new OriginalGamesAdminService({ models });
  const q = (sql) => models.Staff.sequelize.query(sql);

  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  const [agentA, agentB, playerA, playerB] = [newId(), newId(), newId(), newId()];
  const game = `t-og-${agentA}`;

  t.before(async () => {
    await models.Staff.bulkCreate([
      { id: agentA, name: `og-a-${agentA}`, email: `oga${agentA}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: agentB, name: `og-b-${agentB}`, email: `ogb${agentB}@t.test`, password: 'x', role_id: roleId, parent_id: null },
    ]);
    await models.Users.bulkCreate([
      { id: playerA, name: `og-player-a-${playerA}`, password: 'x', status: 'active', parent_staff_id: agentA },
      { id: playerB, name: `og-player-b-${playerB}`, password: 'x', status: 'active', parent_staff_id: agentB },
    ]);
    await q(`INSERT INTO og_games (code, name, position, data, synced_at) VALUES ('${game}', 'Scope Test Game', 999, '{}', now())`);
    await q(`INSERT INTO og_transactions (transaction_id, kind, status, user_id, game_code, currency, amount, round_id, created_at) VALUES
               ('${game}-a', 'bet', 'applied', ${playerA}, '${game}', 'INR', 1000, '${game}-ra', now()),
               ('${game}-b', 'bet', 'applied', ${playerB}, '${game}', 'INR', 5000, '${game}-rb', now())`);
  });

  t.after(async () => {
    await q(`DELETE FROM og_transactions WHERE game_code = '${game}'`);
    await q(`DELETE FROM og_games WHERE code = '${game}'`);
    await models.Users.destroy({ where: { id: [playerA, playerB] } });
    await models.Staff.destroy({ where: { id: [agentA, agentB] } });
    await connection.close();
  });

  const asA = { id: agentA, level: 6, permissions: ['reports:read'] };

  await t.test('bet history: only the agent\'s own player', async () => {
    const { rows, total } = await service.bets({ staff: asA, channel: 'agent', game, page: 1, limit: 25 });
    assert.equal(total, 1);
    assert.deepEqual(rows.map((r) => r.userId), [String(playerA)]);
  });

  await t.test('stats: only the agent\'s own player\'s wager', async () => {
    const stats = await service.stats({ staff: asA, channel: 'agent', currency: 'INR' });
    const row = stats.byGame.find((g) => g.code === game);
    assert.equal(row.bets, 1);
    assert.equal(row.players, 1);
  });

  await t.test('games: play counts from the agent\'s own players', async () => {
    const { games } = await service.games({ staff: asA, channel: 'agent' });
    assert.equal(games.find((g) => g.code === game).bets, 1);
  });

  await t.test('a staff below the Super Admin has no direct users', async () => {
    const { total } = await service.bets({ staff: asA, channel: 'direct', game, page: 1, limit: 25 });
    assert.equal(total, 0);
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { CatalogueService } = require('../catalogue.service');
const v = require('../catalogue.validators');

/**
 * Sport configuration and fancy market visibility.
 *
 * These are the first tests the fancy controls have ever had, and the first
 * time their table has existed — `admin_fancy_control` was referenced seven
 * times by five mounted routes and created by nothing. See migration 024.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

const tag = `cat-${process.pid}`;

/**
 * `sports_config.game_id` is an INTEGER column, so sport ids in these fixtures
 * are numbers — unlike the fancy control ids, which are the provider's strings.
 */
let nextGameId = 800_000 + (process.pid % 1000) * 100;
const newGameId = () => (nextGameId += 1);

test('sports catalogue', async (t) => {
  const logger = createLogger({ name: 'catalogue-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The schemas — no database needed
  // ══════════════════════════════════════════════════════════════════════

  await t.test('showFancy must be a real boolean', async () => {
    /**
     * `{"showFancy":"false"}` is a truthy string. Coerced, it would OPEN a
     * market somebody meant to close — the wrong direction for a visibility
     * switch to fail in, since an open fancy market is a bettable one.
     */
    const parse = (body) => v.setFancyStatus.body.safeParse(body);
    const base = { eventId: 'e1', marketId: 'm1' };

    assert.equal(parse({ ...base, showFancy: false }).success, true);
    assert.equal(parse({ ...base, showFancy: 'false' }).success, false);
    assert.equal(parse({ ...base, showFancy: 0 }).success, false);
  });

  await t.test('a bulk update is bounded', async () => {
    // It becomes one INSERT ... ON CONFLICT; an unbounded array is an
    // unbounded statement.
    const markets = (n) =>
      Array.from({ length: n }, (_, i) => ({ marketId: `m${i}`, showFancy: false }));

    assert.equal(v.bulkSetFancyStatus.body.safeParse({ eventId: 'e', markets: markets(500) }).success, true);
    assert.equal(v.bulkSetFancyStatus.body.safeParse({ eventId: 'e', markets: markets(501) }).success, false);
    assert.equal(v.bulkSetFancyStatus.body.safeParse({ eventId: 'e', markets: [] }).success, false);
  });

  await t.test('a new sport defaults to OFF', async () => {
    // Legacy required `typeof enabled === 'boolean'` and rejected the request
    // without it. Defaulting is friendlier, and off is the safe default — a
    // sport nobody has looked at should not be on the board.
    const parsed = v.addSport.body.parse({ gameId: '4', gameName: 'Cricket' });
    assert.equal(parsed.enabled, false);
    assert.equal(parsed.gameId, 4, 'and the id is coerced to the integer the column stores');
  });

  await t.test('a non-numeric sport id is refused before it reaches Postgres', async () => {
    // `sports_config.game_id` is INTEGER. Comparing it against 'cricket' is a
    // type error from the database, not an empty result.
    assert.equal(v.addSport.body.safeParse({ gameId: 'cricket', gameName: 'X' }).success, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Against a real database
  // ══════════════════════════════════════════════════════════════════════

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
      service: 'sports-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new CatalogueService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'sports-service' },
  });

  const staff = { id: 91 };

  // ── Sports ────────────────────────────────────────────────────────────

  await t.test('a sport cannot be configured twice', async () => {
    /**
     * `sports_config.game_id` has no unique constraint and legacy's `addGame`
     * was a bare INSERT. Two rows for one sport, and the enabled-games filter
     * — which decides what a player sees — matched whichever came back first.
     */
    const gameId = newGameId();
    await connection.models.SportsConfig.destroy({ where: { game_id: gameId } });

    await service.addSport({ gameId, gameName: 'Test Sport', enabled: true });
    await assert.rejects(
      () => service.addSport({ gameId, gameName: 'Test Sport Again', enabled: false }),
      (err) => err.code === 'CATALOGUE_SPORT_EXISTS' && err.status === 409
    );

    const rows = await connection.models.SportsConfig.count({ where: { game_id: gameId } });
    assert.equal(rows, 1);
  });

  await t.test('an update naming nothing is refused, not a syntax error', async () => {
    // Legacy built the SET clause from whichever fields were present and,
    // given none, produced `UPDATE sports_config SET  WHERE id = $1` — a
    // Postgres syntax error surfaced to the caller as a 500.
    const gameId = newGameId();
    await connection.models.SportsConfig.destroy({ where: { game_id: gameId } });
    const sport = await service.addSport({ gameId, gameName: 'Empty' });

    await assert.rejects(
      () => service.updateSport({ id: sport.id }),
      (err) => err.code === 'CATALOGUE_NOTHING_TO_UPDATE' && err.status === 422
    );
  });

  await t.test('a sport that does not exist is a 404', async () => {
    await assert.rejects(
      () => service.updateSport({ id: 2_147_000_007, enabled: true }),
      (err) => err.code === 'CATALOGUE_SPORT_NOT_FOUND'
    );
  });

  // ── Fancy controls ────────────────────────────────────────────────────

  await t.test('closing a market twice does not create two controls', async () => {
    const eventId = `${tag}-e1`;
    const marketId = `${tag}-m1`;
    await connection.models.AdminFancyControl.destroy({ where: { market_id: marketId } });

    await service.setFancyStatus({ eventId, marketId, marketName: 'Over 6', showFancy: false, staffId: staff.id });
    await service.setFancyStatus({ eventId, marketId, marketName: 'Over 6', showFancy: false, staffId: staff.id });

    const rows = await connection.models.AdminFancyControl.count({ where: { market_id: marketId } });
    assert.equal(rows, 1);
  });

  await t.test('reopening a market keeps when the control was created', async () => {
    /**
     * Legacy's upsert set `created_at = NOW()` on the UPDATE branch, so every
     * change overwrote when the control was first made — and there was no
     * `updated_at` at all. "When did somebody last touch this market" had no
     * answer, and neither did "when was it first closed".
     */
    const eventId = `${tag}-e2`;
    const marketId = `${tag}-m2`;
    await connection.models.AdminFancyControl.destroy({ where: { market_id: marketId } });

    await service.setFancyStatus({ eventId, marketId, showFancy: false, staffId: staff.id });
    const first = await connection.models.AdminFancyControl.findOne({ where: { market_id: marketId }, raw: true });

    await new Promise((resolve) => setTimeout(resolve, 15));
    await service.setFancyStatus({ eventId, marketId, showFancy: true, staffId: 92 });
    const second = await connection.models.AdminFancyControl.findOne({ where: { market_id: marketId }, raw: true });

    assert.equal(
      new Date(second.created_at).getTime(),
      new Date(first.created_at).getTime(),
      'created_at must survive the update'
    );
    assert.ok(
      new Date(second.updated_at).getTime() > new Date(first.updated_at).getTime(),
      'updated_at must move'
    );
    assert.equal(second.show_fancy, true);
    assert.equal(Number(second.updated_by), 92, 'and it records who did it');
  });

  await t.test('a bulk update is one statement and lands atomically', async () => {
    // Legacy looped and ran one upsert per market, none of them in a
    // transaction — a failure halfway left some markets closed and some open
    // with no way to tell which.
    const eventId = `${tag}-e3`;
    const markets = Array.from({ length: 20 }, (_, i) => ({
      marketId: `${tag}-b${i}`,
      marketName: `Session ${i}`,
      showFancy: i % 2 === 0,
    }));
    await connection.models.AdminFancyControl.destroy({ where: { event_id: eventId } });

    const result = await service.bulkSetFancyStatus({ eventId, markets, staffId: staff.id });

    assert.equal(result.length, 20);
    assert.equal(result.filter((r) => !r.showFancy).length, 10);
  });

  await t.test('a bulk update re-run flips the same rows rather than duplicating', async () => {
    const eventId = `${tag}-e4`;
    const markets = [{ marketId: `${tag}-b100`, showFancy: false }];
    await connection.models.AdminFancyControl.destroy({ where: { event_id: eventId } });

    await service.bulkSetFancyStatus({ eventId, markets, staffId: staff.id });
    await service.bulkSetFancyStatus({
      eventId, markets: [{ marketId: `${tag}-b100`, showFancy: true }], staffId: staff.id,
    });

    const rows = await connection.models.AdminFancyControl.findAll({ where: { event_id: eventId }, raw: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].show_fancy, true);
  });

  await t.test('removing a control makes the market VISIBLE again', async () => {
    // Worth asserting because "delete the control" reads like "hide it" and
    // does the opposite — the market returns to its default, which is open.
    const eventId = `${tag}-e5`;
    const marketId = `${tag}-m5`;
    await connection.models.AdminFancyControl.destroy({ where: { market_id: marketId } });

    await service.setFancyStatus({ eventId, marketId, showFancy: false, staffId: staff.id });
    await service.removeFancyControl({ marketId, staffId: staff.id });

    const hidden = await service.listFancyControls({ eventId, hiddenOnly: true });
    assert.equal(hidden.total, 0, 'nothing is hidden for this event any more');
  });

  await t.test('removing a control that is not there is a 404', async () => {
    await assert.rejects(
      () => service.removeFancyControl({ marketId: `${tag}-nope` }),
      (err) => err.code === 'CATALOGUE_FANCY_CONTROL_NOT_FOUND' && err.status === 404
    );
  });

  await t.test('the control listing is paged — legacy returned the whole table', async () => {
    const eventId = `${tag}-e6`;
    await connection.models.AdminFancyControl.destroy({ where: { event_id: eventId } });
    await service.bulkSetFancyStatus({
      eventId,
      markets: Array.from({ length: 5 }, (_, i) => ({ marketId: `${tag}-p${i}`, showFancy: false })),
      staffId: staff.id,
    });

    const page = await service.listFancyControls({ eventId, limit: 2, offset: 0 });
    assert.equal(page.rows.length, 2);
    assert.equal(page.total, 5);
  });
});

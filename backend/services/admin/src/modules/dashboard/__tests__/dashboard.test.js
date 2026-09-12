'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { DashboardService } = require('../dashboard.service');
const v = require('../dashboard.validators');

/**
 * The dashboard.
 *
 * The thing worth proving: a deposit in a currency with no exchange rate is
 * REPORTED rather than dropped. Legacy joined `exchangerate` with an INNER
 * JOIN, so those rows silently left the platform's own revenue figure.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextId = 400_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('dashboard validators', async (t) => {
  await t.test('the today list has a page ceiling', () => {
    // Legacy returned `SELECT *` of every deposit made today, unauthenticated.
    assert.equal(v.today.query.safeParse({ limit: '100000' }).success, false);
    assert.equal(v.today.query.parse({}).limit, 100);
    assert.equal(v.today.query.parse({}).kind, 'both');
  });

  await t.test('unknown query parameters are rejected', () => {
    assert.equal(v.today.query.safeParse({ nonsense: '1' }).success, false);
  });
});

test('dashboard against a database', async (t) => {
  const logger = createLogger({ name: 'dashboard-test', level: 'silent' });

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
  const service = new DashboardService({ models, db: connection, logger, config: {} });

  const player = newId();
  /** A currency with no row in `exchangerate` — the case legacy dropped. */
  const ORPHAN_CURRENCY = 'ZZZ';

  t.before(async () => {
    await models.FiatDeposits.destroy({ where: { user_id: String(player) } });
    await models.Users.destroy({ where: { id: player } });

    await models.Users.create({ id: player, name: `d-${player}`, password: 'x', status: 'active' });

    // A rate we control, so the conversion is checkable.
    await models.Exchangerate.destroy({ where: { currency: 'TESTCOIN' } });
    await models.Exchangerate.create({ currency: 'TESTCOIN', usd_rate: '2.5' });

    await models.FiatDeposits.bulkCreate([
      {
        user_id: String(player),
        amount: '100',
        currency: 'TESTCOIN',
        status: 'approved',
        account_holder_name: 'Test',
        created_at: new Date(),
      },
      {
        user_id: String(player),
        amount: '999',
        // No rate exists for this one.
        currency: ORPHAN_CURRENCY,
        status: 'approved',
        account_holder_name: 'Test',
        created_at: new Date(),
      },
    ]);
  });

  t.after(async () => {
    await models.FiatDeposits.destroy({ where: { user_id: String(player) } });
    await models.Users.destroy({ where: { id: player } });
    await models.Exchangerate.destroy({ where: { currency: 'TESTCOIN' } });
    if (connection) await connection.close();
  });

  await t.test('a rate is applied exactly, not through a float', async () => {
    const overview = await service.overview();
    const converted = overview.deposits.lifetime.byCurrency.find((c) => c.currency === 'TESTCOIN');

    assert.ok(converted, 'the deposit is counted');
    // 100 × 2.5 = 250, exactly.
    assert.equal(converted.usd, '250.00000000');
    assert.equal(converted.amount, '100.00000000');
  });

  await t.test('A DEPOSIT WITH NO EXCHANGE RATE IS REPORTED, NOT DROPPED', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * Legacy:
     *
     *     FROM fiat_deposits f
     *     JOIN exchangerate e ON f.currency = e.currency
     *
     * An INNER join. The 999 below simply vanished from the total, and the
     * figure was smaller with nothing to say so.
     * ═══════════════════════════════════════════════════════════════════
     */
    const overview = await service.overview();
    const orphan = overview.deposits.lifetime.unconverted.find((u) => u.currency === ORPHAN_CURRENCY);

    assert.ok(orphan, 'the unconvertible deposit is listed');
    assert.equal(orphan.amount, '999.00000000');
    assert.equal(orphan.reason, 'no exchange rate');

    // And it is NOT silently folded into the USD figure at face value either,
    // which would be the other wrong answer.
    const inUsd = overview.deposits.lifetime.byCurrency.find((c) => c.currency === ORPHAN_CURRENCY);
    assert.equal(inUsd, undefined);
  });

  await t.test('the lifetime figure carries its health warning', async () => {
    /**
     * `exchangerate` holds one rate per currency — the current one — so a
     * lifetime total is marked to today and moves as rates move. Legacy said
     * nothing about this on a figure labelled "total deposits".
     */
    const overview = await service.overview();
    assert.equal(overview.valuation.currency, 'USD');
    assert.match(overview.valuation.note, /marked to today/i);
  });

  await t.test('user stats name the signup count for what it is', async () => {
    /**
     * Legacy called this `activeUsers30d` and computed it from `created` — the
     * REGISTRATION date. A player who joined two years ago and bet this
     * morning was not counted; one who registered last week and never returned
     * was.
     */
    const stats = await service.userStats();

    assert.equal('activeUsers30d' in stats, false, 'the misleading name is gone');
    assert.equal(typeof stats.registeredLast30Days, 'number');
    assert.equal(typeof stats.registeredPrevious30Days, 'number');
    assert.ok(Array.isArray(stats.registrationTrend));
    assert.ok(Array.isArray(stats.topCountries));
  });

  await t.test('an unknown player has no team rather than a crash', async () => {
    await assert.rejects(
      () => service.memberTeam({ userId: 999_999_999 }),
      (err) => err.code === 'DASHBOARD_PLAYER_NOT_FOUND'
    );
  });

  await t.test("today's list carries no wallet addresses or transaction ids", async () => {
    // Legacy's `SELECT * FROM deposits` returned every column to an
    // unauthenticated caller.
    const today = await service.today({ kind: 'both', limit: 10, offset: 0 });

    for (const row of today.rows) {
      assert.equal('address' in row, false);
      assert.equal('txid' in row, false);
      assert.equal('screenshot_path' in row, false);
      assert.ok('amount' in row && 'direction' in row);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The drill-down
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a window ADDS a figure rather than redefining lifetime', async () => {
    /**
     * A field called `lifetime` that means "the last fortnight" is the class
     * of lie this module keeps unwinding, so a windowed request answers all
     * three and says which window it was given.
     */
    const wide = await service.overview({ from: new Date(0), to: new Date() });

    assert.ok(wide.range, 'the window is echoed back');
    assert.ok(wide.deposits.range, 'the windowed figure is present');
    assert.ok(wide.deposits.lifetime, 'and lifetime still means lifetime');
    assert.equal(wide.deposits.range.usd, wide.deposits.lifetime.usd, 'a window of all time equals lifetime');

    // An unwindowed request must not grow the key.
    const plain = await service.overview();
    assert.equal(plain.range, null);
    assert.equal('range' in plain.deposits, false);
  });

  await t.test('a window that excludes everything reports zero, not lifetime', async () => {
    const past = new Date('2000-01-01T00:00:00Z');
    const empty = await service.overview({ from: new Date('1999-01-01T00:00:00Z'), to: past });

    assert.equal(empty.deposits.range.usd, '0.00000000');
    assert.equal(empty.deposits.range.count, 0);
    // The lifetime figure is untouched by the filter.
    assert.notEqual(empty.deposits.lifetime.count, 0);
  });

  await t.test('the drill-down reads the SAME tables as the total', async () => {
    /**
     * `/today` selects from `deposits`; the headline sums `ccdeposit`,
     * `fiat_deposits`, `apaydeposits` and `pay_in_transactions`. So the list a
     * reader opened from a total never contained the rows behind it. These
     * seeded rows are in `fiat_deposits` — one of the four — and must appear.
     */
    const page = await service.movements({ kind: 'deposits', userId: player, limit: 50, offset: 0 });

    assert.equal(page.total, 2, 'both seeded deposits are found');
    assert.ok(page.rows.every((r) => r.source === 'bank_deposit'));
    assert.ok(page.rows.every((r) => r.sourceLabel === 'Bank deposit'), 'the row names where it came from');

    // The totals on the drill-down match the headline for the same filter.
    const overview = await service.overview();
    const seeded = overview.deposits.lifetime.byCurrency.find((c) => c.currency === 'TESTCOIN');
    const drilled = page.totals.byCurrency.find((c) => c.currency === 'TESTCOIN');
    assert.equal(drilled.usd, seeded.usd);
  });

  await t.test('an unconvertible row is null, not zero', async () => {
    // A row worth an unknown amount and a row worth nothing are different
    // facts; the gap is already reported separately under `unconverted`.
    const page = await service.movements({ kind: 'deposits', userId: player, limit: 50, offset: 0 });

    const orphan = page.rows.find((r) => r.currency === ORPHAN_CURRENCY);
    assert.equal(orphan.usd, null);
    assert.equal(page.totals.unconverted.some((u) => u.currency === ORPHAN_CURRENCY), true);

    const priced = page.rows.find((r) => r.currency === 'TESTCOIN');
    assert.equal(priced.usd, '250.00000000');
  });

  await t.test('a drill-down row carries no bank account or screenshot path', async () => {
    // `fiat_deposits` holds an account number, an IFSC code and the path to a
    // photograph of the transfer. None of it is a dashboard's business.
    const page = await service.movements({ kind: 'both', userId: player, limit: 50, offset: 0 });

    for (const row of page.rows) {
      for (const leaked of ['account_number', 'ifsc_code', 'screenshot_path', 'upi_id', 'wallet', 'transaction_id']) {
        assert.equal(leaked in row, false, `${leaked} must not be on a drill-down row`);
      }
      assert.ok(row.source && row.direction && 'usd' in row);
    }
  });

  await t.test('a movement window filters the rows too', async () => {
    const none = await service.movements({
      kind: 'deposits',
      userId: player,
      from: new Date('1999-01-01T00:00:00Z'),
      to: new Date('2000-01-01T00:00:00Z'),
      limit: 50,
      offset: 0,
    });

    assert.equal(none.total, 0);
    assert.equal(none.rows.length, 0);
    assert.equal(none.totals.usd, '0.00000000');
  });

  await t.test('registrations list the players behind the count', async () => {
    const page = await service.registrations({ search: `d-${player}`, limit: 10, offset: 0 });

    assert.equal(page.total, 1);
    assert.equal(page.rows[0].id, String(player));
    assert.equal(page.rows[0].verified, false);
    // A direct signup has no parent staff — the tab's own distinction.
    assert.equal(page.rows[0].channel, 'direct');
    assert.equal('password' in page.rows[0], false);
  });

  await t.test('paging beyond the merge ceiling is refused, not attempted', () => {
    // Six tables merged in memory; an unbounded offset is six full scans.
    assert.equal(v.movements.query.safeParse({ offset: '10000', limit: '200' }).success, false);
    assert.equal(v.movements.query.safeParse({ offset: '0', limit: '200' }).success, true);
  });

  await t.test('a backwards window is refused rather than answered empty', () => {
    const backwards = { from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' };
    assert.equal(v.overview.query.safeParse(backwards).success, false);
    assert.equal(v.movements.query.safeParse(backwards).success, false);
    assert.equal(v.overview.query.safeParse({}).success, true);
  });
});

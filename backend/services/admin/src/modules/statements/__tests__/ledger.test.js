'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildLedger, dailyFromEvents, finishDaily, finaliseGaming, place } = require('../ledger');
const { KIND } = require('../statements.constants');

/**
 * The statement arithmetic.
 *
 * No database. This is the one piece of the module where being wrong is silent
 * — a statement that closes a few paise away from the wallet looks like a
 * statement, and legacy's `Math.round(n * 100) / 100` after every step of a
 * running sum made exactly that error.
 */

const event = (ts, kind, amount, label = kind) => ({ ts, kind, label, amount, party: '—' });

test('the running balance is anchored on the live wallet', async (t) => {
  await t.test('the last row equals the wallet when the period is up to date', () => {
    /**
     * Legacy's design, and the reason for it: start from zero and add up, and
     * the closing figure disagrees with the wallet whenever anything ever moved
     * money by a path the statement does not read. Anchoring puts that whole
     * discrepancy in the opening figure, where it reads as "brought forward".
     */
    const events = [
      event('2026-01-01T10:00:00Z', KIND.DEPOSIT_UPLINE, '1000'),
      event('2026-01-02T10:00:00Z', KIND.SPORTS, '-300'),
      event('2026-01-03T10:00:00Z', KIND.SPORTS, '500'),
    ];

    const ledger = buildLedger(events, '1200', { page: 1, limit: 100 });

    assert.equal(ledger.closing, '1200.00000000');
    assert.equal(ledger.opening, '0.00000000');
    assert.equal(ledger.movement, '1200.00000000');
    // Newest first for display, so the FIRST row carries the closing balance.
    assert.equal(ledger.rows[0].balance, '1200.00000000');
    assert.equal(ledger.rows.at(-1).balance, '1000.00000000');
  });

  await t.test('movements AFTER the period are wound back out of the closing figure', () => {
    const events = [
      event('2026-01-02T10:00:00Z', KIND.DEPOSIT_UPLINE, '1000'),
      event('2026-02-15T10:00:00Z', KIND.DEPOSIT_UPLINE, '500'),
    ];

    const ledger = buildLedger(events, '1500', { from: '2026-01-01', to: '2026-01-31', page: 1, limit: 100 });

    assert.equal(ledger.closing, '1000.00000000', 'the February deposit is not in January');
    assert.equal(ledger.opening, '0.00000000');
    assert.equal(ledger.rows.length, 1);
  });

  await t.test('an unreadable movement lands in `unexplained`, not in the rows', () => {
    /**
     * The wallet holds 5000; the events account for 1000. The other 4000 got
     * there some other way — a historical GT settlement, a direct write. It is
     * reported rather than absorbed.
     */
    const events = [event('2026-01-02T10:00:00Z', KIND.DEPOSIT_UPLINE, '1000')];
    const ledger = buildLedger(events, '5000', { page: 1, limit: 100 });

    assert.equal(ledger.unexplained, '4000.00000000');
    assert.equal(ledger.closing, '5000.00000000', 'and the closing figure is still the real wallet');
  });

  await t.test('a thousand rows of a third of a rupee do not drift', () => {
    /**
     * THIS IS THE TEST THE LEGACY IMPLEMENTATION FAILS.
     *
     *     const round2 = (n) => Math.round(n * 100) / 100;
     *     run += e.amount; e.balance = round2(run);
     *
     * `0.33333333` is not representable in a double, and rounding after every
     * step accumulates the error rather than removing it. Exact minor units
     * here, so the closing figure is the sum and nothing else.
     */
    const events = Array.from({ length: 1000 }, (_, i) =>
      event(new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), KIND.SPORTS, '0.33333333')
    );

    const ledger = buildLedger(events, '333.33333000', { page: 1, limit: 5 });

    assert.equal(ledger.movement, '333.33333000');
    assert.equal(ledger.closing, '333.33333000');
    assert.equal(ledger.opening, '0.00000000');
  });

  await t.test('paging does not change any balance', () => {
    // A running balance that depends on which page you asked for is not one.
    const events = Array.from({ length: 30 }, (_, i) =>
      event(new Date(Date.UTC(2026, 0, 1, i)).toISOString(), KIND.DEPOSIT_UPLINE, '100')
    );

    const first = buildLedger(events, '3000', { page: 1, limit: 10 });
    const third = buildLedger(events, '3000', { page: 3, limit: 10 });

    assert.equal(first.opening, third.opening);
    assert.equal(first.closing, third.closing);
    assert.equal(first.rows[0].balance, '3000.00000000');
    // Page 3 is the OLDEST ten, so its last row is the first movement.
    assert.equal(third.rows.at(-1).balance, '100.00000000');
    assert.equal(third.pagination.totalPages, 3);
  });

  await t.test('a category filter changes which rows are LISTED, not the balances', () => {
    const events = [
      event('2026-01-01T10:00:00Z', KIND.DEPOSIT_UPLINE, '1000'),
      event('2026-01-02T10:00:00Z', KIND.SPORTS, '-300'),
      event('2026-01-03T10:00:00Z', KIND.CASINO, '-200'),
    ];

    const all = buildLedger(events, '500', { page: 1, limit: 100, category: 'all' });
    const money = buildLedger(events, '500', { page: 1, limit: 100, category: 'money' });

    assert.equal(all.rows.length, 3);
    assert.equal(money.rows.length, 1);
    assert.equal(all.closing, money.closing, 'the balance is the balance');
    assert.equal(all.opening, money.opening);
  });

  await t.test('an empty statement is zeros, not a crash', () => {
    const ledger = buildLedger([], '0', { page: 1, limit: 100 });
    assert.equal(ledger.opening, '0.00000000');
    assert.equal(ledger.closing, '0.00000000');
    assert.equal(ledger.rows.length, 0);
    assert.equal(ledger.pagination.totalPages, 1);
  });

  await t.test("a player's statement (anchor: events) opens at what the events held before the range", () => {
    // A same-day account the events only partly explain: opening 0, not live − movements (2,275).
    const events = [
      event('2026-10-19T06:43:00Z', KIND.SWAP, '2475'),
      event('2026-10-19T06:46:00Z', KIND.SPORTS, '-100'),
    ];
    const range = { from: '2026-09-19', to: '2026-10-19', page: 1, limit: 100, anchor: 'events' };
    const ledger = buildLedger(events, '9999', range);
    assert.equal(ledger.opening, '0.00000000');
    assert.equal(ledger.closing, '2375.00000000');
    assert.equal(ledger.rows[0].balance, '2375.00000000');
    assert.equal(ledger.unexplained, '7624.00000000', 'the wallet drift is still reported');

    const before = buildLedger([event('2026-09-01T06:00:00Z', KIND.BANK_DEPOSIT, '50'), ...events], '2425', range);
    assert.equal(before.opening, '50.00000000');
    assert.equal(before.closing, '2425.00000000');
  });
});

test('range placement', async (t) => {
  await t.test('a bound is inclusive of its whole day', () => {
    assert.equal(place('2026-01-15T23:59:59Z', '2026-01-01', '2026-01-15'), 0);
    assert.equal(place('2026-01-16T00:00:01Z', '2026-01-01', '2026-01-15'), 1);
    assert.equal(place('2025-12-31T23:59:59Z', '2026-01-01', '2026-01-15'), -1);
  });

  await t.test('no bounds means everything is inside', () => {
    assert.equal(place('1999-01-01T00:00:00Z', null, null), 0);
  });
});

test('daily roll-up', async (t) => {
  await t.test('money in and out are separated, gaming is not counted twice', () => {
    const events = [
      event('2026-01-01T10:00:00Z', KIND.DEPOSIT_UPLINE, '1000'),
      event('2026-01-01T12:00:00Z', KIND.WITHDRAW_UPLINE, '-400'),
      // Play is summarised from the aggregate queries, not from these rows —
      // counting both would double it.
      event('2026-01-01T14:00:00Z', KIND.SPORTS, '-250'),
    ];

    const { days } = dailyFromEvents(events);
    const rendered = finishDaily(days);

    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].deposit, '1000.00000000');
    assert.equal(rendered[0].withdraw, '400.00000000');
    assert.equal(rendered[0].net, '600.00000000');
    assert.equal(rendered[0].sportsPnl, '0.00000000');
  });

  await t.test('days come back newest first', () => {
    const events = [
      event('2026-01-01T10:00:00Z', KIND.DEPOSIT_UPLINE, '100'),
      event('2026-01-03T10:00:00Z', KIND.DEPOSIT_UPLINE, '100'),
      event('2026-01-02T10:00:00Z', KIND.DEPOSIT_UPLINE, '100'),
    ];
    const rendered = finishDaily(dailyFromEvents(events).days);
    assert.deepEqual(rendered.map((d) => d.date), ['2026-01-03', '2026-01-02', '2026-01-01']);
  });
});

test('whose profit is it', async (t) => {
  await t.test('the agent keeps exactly what the player loses', () => {
    const agentView = finaliseGaming({ sportsPlayerPnl: '-300', casinoPlayerPnl: '-200', headlineFor: 'AGENT' });

    assert.equal(agentView.total.playerPnl, '-500.00000000');
    assert.equal(agentView.total.agentPnl, '500.00000000');
    assert.equal(agentView.total.headlinePnl, '500.00000000', 'the agent is up 500');
  });

  await t.test('the same numbers from the player side', () => {
    const playerView = finaliseGaming({ sportsPlayerPnl: '-300', casinoPlayerPnl: '-200', headlineFor: 'PLAYER' });
    assert.equal(playerView.total.headlinePnl, '-500.00000000', 'the player is down 500');
    // The two views are negations of one number, so they cannot disagree.
    assert.equal(playerView.total.agentPnl, '500.00000000');
  });

  await t.test('a winning player leaves the agent negative', () => {
    const view = finaliseGaming({ sportsPlayerPnl: '1200.50', casinoPlayerPnl: '0', headlineFor: 'AGENT' });
    assert.equal(view.total.headlinePnl, '-1200.50000000');
    assert.equal(view.total.headlineSports, '-1200.50000000');
    assert.equal(view.total.headlineCasino, '0.00000000');
  });
});

test('`unexplained` is the period: closing − opening − (in − out) − play', async (t) => {
  const { periodUnexplained, periodPlay } = require('../ledger');

  await t.test('a balanced week is zero even when the wallet holds money no event explains', () => {
    /**
     * The reported case (player 9346619383, 2026-10-03..09): the wallet holds
     * 1000 that arrived by a path the statement does not read, then +2000,
     * +3000 and −5000 inside the week. Opening 1000, closing 1000, in 5000,
     * out 5000 — every figure adds up, yet the old `live − lifetimeNet`
     * formula reported 1000.00 unexplained.
     */
    const events = [
      event('2026-10-09T10:00:00Z', KIND.DEPOSIT_UPLINE, '2000'),
      event('2026-10-09T10:01:00Z', KIND.DEPOSIT_UPLINE, '3000'),
      event('2026-10-09T10:02:00Z', KIND.WITHDRAW_UPLINE, '-5000'),
    ];
    const ledger = buildLedger(events, '1000', { from: '2026-10-03', to: '2026-10-09' });
    assert.equal(ledger.opening, '1000.00000000');
    assert.equal(ledger.closing, '1000.00000000');
    // The wallet drift is still visible, separately.
    assert.equal(ledger.unexplained, '1000.00000000');

    const unexplained = periodUnexplained({
      opening: ledger.opening,
      closing: ledger.closing,
      totalIn: '5000',
      totalOut: '5000',
      play: periodPlay(ledger.inside),
    });
    assert.equal(unexplained, '0.00000000');
  });

  await t.test('in-period play is explained by the ledger, not reported as drift', () => {
    const events = [
      event('2026-10-04T10:00:00Z', KIND.DEPOSIT_UPLINE, '500'),
      event('2026-10-05T10:00:00Z', KIND.SPORTS, '-120'),
      event('2026-10-05T11:00:00Z', KIND.CASINO, '45.5'),
    ];
    const ledger = buildLedger(events, '425.5', { from: '2026-10-03', to: '2026-10-09' });
    assert.equal(periodPlay(ledger.inside), '-74.50000000');
    assert.equal(
      periodUnexplained({
        opening: ledger.opening, closing: ledger.closing, totalIn: '500', totalOut: '0', play: periodPlay(ledger.inside),
      }),
      '0.00000000'
    );
  });

  await t.test('a movement no total accounts for is the difference', () => {
    // closing − opening = 300, in − out = 200 → 100 unexplained.
    assert.equal(
      periodUnexplained({ opening: '1000', closing: '1300', totalIn: '250', totalOut: '50' }),
      '100.00000000'
    );
  });
});

test('list queries accept `offset` beside `page` (the admin UI sends limit+offset)', async (t) => {
  const v = require('../statements.validators');
  const blogs = require('../../blogs/blogs.validators');

  await t.test('GET /admin/statements/user/:id/bets?limit=50&offset=0 is not a 422', () => {
    const parsed = v.userBets.query.safeParse({ kind: 'casino', from: '2026-10-03', to: '2026-10-09', limit: '50', offset: '0' });
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data.page, 1);
    assert.equal(parsed.data.limit, 50);
    assert.equal('offset' in parsed.data, false, 'folded into page');
  });

  await t.test('offset becomes the page it falls on', () => {
    assert.equal(v.userStatement.query.parse({ limit: '20', offset: '40' }).page, 3);
    assert.equal(v.agentBets.query.parse({ limit: '50', offset: '50' }).page, 2);
    assert.equal(v.userPdf.query.parse({ page: '4' }).page, 4, 'page alone still works');
  });

  await t.test('GET /admin/blogs?limit=20&offset=0 is not a 422', () => {
    const parsed = blogs.list.query.safeParse({ limit: '20', offset: '0' });
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data.page, 1);
    assert.equal(blogs.byCategory.query.parse({ limit: '10', offset: '30' }).page, 4);
  });

  await t.test('unknown keys are still refused', () => {
    assert.equal(v.userBets.query.safeParse({ limit: '50', skip: '0' }).success, false);
    assert.equal(blogs.list.query.safeParse({ limit: '20', skip: '0' }).success, false);
  });
});

test('a row carrying the wallet after it moved post − running', () => {
  /**
   * Live, Testuser10: a fancy YES 55 @ 100 for ₹100 won. The exchange's settlement row says
   * amount 100 (the profit) while the wallet got 200 (stake back + profit); the statement
   * closed ₹100 under the wallet. `post` is the wallet the exchange recorded after each row.
   */
  const events = [
    event('2026-01-01T10:00:00Z', KIND.BANK_DEPOSIT, '1000'),
    { ...event('2026-01-02T10:00:00Z', KIND.SPORTS, '-100'), post: '900' },
    { ...event('2026-01-02T11:00:00Z', KIND.SPORTS, '100'), post: '1100' },
    // a lost bet settles with nothing moved: dropped
    { ...event('2026-01-02T12:00:00Z', KIND.SPORTS, '-100'), post: '1100' },
  ];
  const ledger = buildLedger(events, '1100', { page: 1, limit: 100, anchor: 'events' });
  assert.equal(ledger.closing, '1100.00000000');
  assert.equal(ledger.rows.length, 3);
  assert.equal(ledger.rows[0].amount, '200.00000000');
  assert.equal('post' in ledger.rows[0], false);
});

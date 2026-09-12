'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { SettlementService } = require('../settlement.service');

/**
 * Business-rule tests for settlement.
 *
 * The service is constructed with a fake repository, so these run with no
 * database and assert on decisions rather than SQL. Each case corresponds to a
 * behaviour that differs from `legacy/mannualsettlement/` — the ones where the
 * port deliberately changed what happens.
 */

/** A service whose repository is replaced wholesale. */
function makeService(repoOverrides = {}, configOverrides = {}) {
  const service = new SettlementService({
    models: {},
    db: {
      sequelize: {},
      transaction: async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
      advisoryLock: async (_key, fn, opts) => ({ acquired: true, result: await fn(opts?.transaction) }),
    },
    config: { SPORTS_VOID_WINDOW_HOURS: 30, SPORTS_MAX_PAYOUT: 100_000, ...configOverrides },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    clients: {},
  });

  service.repo = {
    findDeclaredResult: async () => null,
    createManualResult: async (data) => ({ id: 1, ...data }),
    markBetsManual: async () => 1,
    findAffectedUserIds: async () => [],
    findExposures: async () => [],
    deleteExposures: async () => 1,
    lockCredits: async () => ({ uid: 1, inr: '1000' }),
    creditInr: async () => {},
    debitInrGuarded: async () => true,
    closeBetsAsRefunded: async () => 1,
    lockOpenBet: async () => null,
    countOtherOpenBets: async () => 0,
    closeBetById: async () => 1,
    findLedgerEntriesForMarket: async () => [],
    findLedgerEntryById: async () => null,
    countVoidMarkers: async () => 0,
    reverseUserTotals: async () => {},
    deleteLedgerEntry: async () => 1,
    markBetsVoidedAfterSettlement: async () => 1,
    markBetVoidedAfterSettlement: async () => 1,
    writeVoidMarker: async (row) => ({ id: 99, ...row }),
    ...repoOverrides,
  };

  return service;
}

const baseResult = {
  eventid: 'EV1',
  match_id: '100',
  match_title: 'A v B',
  game_type: 'MO',
  market_type: 'MATCH_ODDS',
  winnerId: '7',
  winnerName: 'A',
};

test('declareResult', async (t) => {
  await t.test('records the result and moves open bets to manual', async () => {
    let markedWith = null;
    const service = makeService({
      markBetsManual: async (args) => {
        markedWith = args;
        return 3;
      },
    });

    const result = await service.declareResult(baseResult);

    assert.equal(result.updatedBets, 3);
    assert.equal(result.manualResult.winnerId, '7');
    assert.equal(markedWith.matchId, '100');
    // A market-level result must NOT filter by selection, or it would settle
    // only one runner's bets.
    assert.equal(markedWith.selectionName, undefined);
  });

  await t.test('rejects a per-selection market with no selection name', async () => {
    const service = makeService();

    // Legacy pushed `undefined` into the parameter list here, which matched no
    // rows and reported success having settled nothing.
    await assert.rejects(
      () => service.declareResult({ ...baseResult, market_type: 'fancy1', fancyName: undefined }),
      (err) => err.code === 'SETTLEMENT_SELECTION_REQUIRED' && err.status === 422
    );
  });

  await t.test('scopes the update by selection for a fancy market', async () => {
    let markedWith = null;
    const service = makeService({
      markBetsManual: async (args) => {
        markedWith = args;
        return 2;
      },
    });

    await service.declareResult({ ...baseResult, market_type: 'khado', fancyName: 'Session 1' });
    assert.equal(markedWith.selectionName, 'Session 1');
  });

  await t.test('refuses to settle a market twice', async () => {
    const service = makeService({
      findDeclaredResult: async () => ({ id: 5, created_at: new Date().toISOString() }),
    });

    await assert.rejects(
      () => service.declareResult(baseResult),
      (err) => err.code === 'SETTLEMENT_MARKET_ALREADY_SETTLED' && err.status === 409
    );
  });

  await t.test('fails loudly when the filter matched no open bets', async () => {
    // Legacy returned 200 with `updatedBets: 0`, which an operator reads as
    // "settled" — the single most dangerous false positive in the module.
    const service = makeService({ markBetsManual: async () => 0 });

    await assert.rejects(
      () => service.declareResult(baseResult),
      (err) => err.code === 'SETTLEMENT_NO_OPEN_BETS' && err.status === 409
    );
  });

  await t.test('refuses when settlement is already running for the market', async () => {
    const service = makeService();
    service.db.advisoryLock = async () => ({ acquired: false, result: null });

    await assert.rejects(
      () => service.declareResult(baseResult),
      (err) => err.code === 'SETTLEMENT_SETTLEMENT_IN_PROGRESS'
    );
  });
});

test('voidMarket', async (t) => {
  await t.test('refunds the worst-case exposure and closes the bets', async () => {
    const credited = [];
    const service = makeService({
      findAffectedUserIds: async () => [11, 22],
      findExposures: async ({ userId }) =>
        userId === 11
          ? [{ exposure_amount: '-250.50' }, { exposure_amount: '100' }]
          : [{ exposure_amount: '-40' }],
      creditInr: async (uid, amount) => credited.push({ uid, amount }),
      closeBetsAsRefunded: async () => 5,
    });

    const result = await service.voidMarket({
      match_id: '100',
      market_type: 'MATCH_ODDS',
      gametype: 'MO',
      selection_name: 'A',
    });

    assert.equal(result.affectedUsers, 2);
    assert.equal(result.closedBets, 5);
    // The refund is the magnitude of the MOST NEGATIVE exposure, not the sum.
    assert.deepEqual(credited, [
      { uid: 11, amount: 250.5 },
      { uid: 22, amount: 40 },
    ]);
    assert.equal(result.refundedTotal, 290.5);
  });

  await t.test('refunds nothing when no exposure was held', async () => {
    const credited = [];
    const service = makeService({
      findAffectedUserIds: async () => [11],
      findExposures: async () => [{ exposure_amount: '0' }, { exposure_amount: '25' }],
      creditInr: async (uid, amount) => credited.push({ uid, amount }),
    });

    const result = await service.voidMarket({
      match_id: '100', market_type: 'MATCH_ODDS', gametype: 'MO', selection_name: 'A',
    });

    assert.equal(credited.length, 0, 'a non-negative exposure must not pay out');
    assert.equal(result.refundedTotal, 0);
  });

  await t.test('rejects a market with no open bets', async () => {
    const service = makeService({ findAffectedUserIds: async () => [] });

    await assert.rejects(
      () => service.voidMarket({ match_id: '1', market_type: 'X', gametype: 'MO', selection_name: 'A' }),
      (err) => err.code === 'SETTLEMENT_NO_OPEN_BETS'
    );
  });
});

test('voidSingleBet', async (t) => {
  const bet = { id: 7, user_id: 11, match_id: '100', market_type: 'MATCH_ODDS' };

  await t.test('releases exposure only when it is the player last bet on the market', async () => {
    const credited = [];
    const service = makeService({
      lockOpenBet: async () => bet,
      countOtherOpenBets: async () => 0,
      findExposures: async () => [{ exposure_amount: '-80' }],
      creditInr: async (uid, amount) => credited.push({ uid, amount }),
    });

    const result = await service.voidSingleBet({ bet_id: 7 });
    assert.equal(result.exposureReleased, true);
    assert.deepEqual(credited, [{ uid: 11, amount: 80 }]);
  });

  await t.test('holds exposure while other open bets remain', async () => {
    const credited = [];
    const service = makeService({
      lockOpenBet: async () => bet,
      countOtherOpenBets: async () => 2,
      findExposures: async () => [{ exposure_amount: '-80' }],
      creditInr: async (uid, amount) => credited.push({ uid, amount }),
    });

    const result = await service.voidSingleBet({ bet_id: 7 });
    assert.equal(result.exposureReleased, false);
    assert.equal(credited.length, 0, 'money still at risk must not be refunded');
  });

  await t.test('rejects a bet that is not open', async () => {
    const service = makeService({ lockOpenBet: async () => null });
    await assert.rejects(
      () => service.voidSingleBet({ bet_id: 7 }),
      (err) => err.code === 'SETTLEMENT_BET_NOT_FOUND' && err.status === 404
    );
  });
});

test('voidMarketAfterSettlement', async (t) => {
  const entry = {
    id: 1, user_id: '11', bet_id: 7, amount: '500', netamount: '300',
    profit: '300', loss: '0', match_id: '100', market_type: 'MATCH_ODDS',
    sport_id: '4', eventid: 'EV1', created_at: new Date().toISOString(),
  };

  await t.test('reverses the payout and writes an audit marker', async () => {
    const debits = [];
    const markers = [];
    const service = makeService({
      findLedgerEntriesForMarket: async () => [entry],
      debitInrGuarded: async (uid, amount) => {
        debits.push({ uid, amount });
        return true;
      },
      writeVoidMarker: async (row) => {
        markers.push(row);
        return { id: 99 };
      },
    });

    const result = await service.voidMarketAfterSettlement({ match_id: '100', market_type: 'MATCH_ODDS' });

    assert.equal(result.processedEntries, 1);
    assert.equal(result.affectedUsers, 1);
    assert.deepEqual(debits, [{ uid: '11', amount: 500 }]);
    assert.equal(markers[0].reason, 'VOID_AFTER_SETTLEMENT');
    // Legacy read a non-existent `credit` column here and always wrote null.
    assert.equal(markers[0].balance, '1000');
  });

  await t.test('refuses when the player has already spent the winnings', async () => {
    // Legacy used an unguarded `SET inr = inr - $1` and drove the balance
    // negative, a state nothing else in the platform handles.
    const service = makeService({
      findLedgerEntriesForMarket: async () => [entry],
      debitInrGuarded: async () => false,
    });

    await assert.rejects(
      () => service.voidMarketAfterSettlement({ match_id: '100', market_type: 'MATCH_ODDS' }),
      (err) => err.code === 'SETTLEMENT_REFUND_FAILED' && err.status === 502
    );
  });

  await t.test('refuses to void the same market twice', async () => {
    const service = makeService({ countVoidMarkers: async () => 1 });

    await assert.rejects(
      () => service.voidMarketAfterSettlement({ match_id: '100', market_type: 'MATCH_ODDS' }),
      (err) => err.code === 'SETTLEMENT_ALREADY_VOIDED'
    );
  });

  await t.test('refuses to void a settlement older than the void window', async () => {
    // The legacy READ endpoints filtered to 30 hours but the WRITE endpoints did
    // not, so a market the UI would not show could still be reversed by id.
    const old = { ...entry, created_at: new Date(Date.now() - 40 * 3600 * 1000).toISOString() };
    const service = makeService({ findLedgerEntriesForMarket: async () => [old] });

    await assert.rejects(
      () => service.voidMarketAfterSettlement({ match_id: '100', market_type: 'MATCH_ODDS' }),
      (err) => err.code === 'SETTLEMENT_VOID_WINDOW_EXPIRED'
    );
  });

  await t.test('walks back lifetime totals so agent reports stay correct', async () => {
    let reversed = null;
    const service = makeService({
      findLedgerEntriesForMarket: async () => [entry],
      reverseUserTotals: async (args) => {
        reversed = args;
      },
    });

    await service.voidMarketAfterSettlement({ match_id: '100', market_type: 'MATCH_ODDS' });

    assert.deepEqual(reversed, { userId: '11', profit: 300, loss: 0, netamount: 300 });
  });
});

test('listFancyMatches groups sessions correctly', async (t) => {
  await t.test('keeps two sessions on one match apart, and merges non-fancy selections', async () => {
    const service = makeService({
      aggregateFancyGroups: async () => [
        { match_id: '1', eventid: 'E', market_type: 'khado', selection_name: 'S1', game_type: 'FAN', totalbets: '2', counts: '10', match_title: 'A v B' },
        { match_id: '1', eventid: 'E', market_type: 'khado', selection_name: 'S2', game_type: 'FAN', totalbets: '1', counts: '11', match_title: 'A v B' },
        { match_id: '1', eventid: 'E', market_type: 'Unlisted Market', selection_name: 'X', game_type: 'FAN', totalbets: '4', counts: null, match_title: 'A v B' },
      ],
      findOpenBetsForGroups: async () => [],
    });

    const payload = await service.listFancyMatches({ limit: 100, offset: 0 });

    assert.equal(payload.khado.length, 2, 'each fancy session is its own market');
    assert.deepEqual(payload.khado.map((g) => g.selectionName).sort(), ['S1', 'S2']);

    assert.equal(payload.others.length, 1, 'unlisted market types fall into others');
    assert.equal(payload.others[0].selectionName, undefined);

    // Every bucket exists even when empty, so the admin UI tabs are stable.
    assert.ok(Array.isArray(payload.oddeven));
  });
});

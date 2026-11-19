'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const fakeDb = () => {
  const log = [];
  return {
    log,
    transaction: async () => {
      const tx = { finished: undefined };
      tx.commit = async () => { tx.finished = 'commit'; log.push('commit'); };
      tx.rollback = async () => { tx.finished = 'rollback'; log.push('rollback'); };
      log.push('open');
      return tx;
    },
  };
};

// Security (N4): a settled bet's status claim and its wallet credit commit together or not at all.
test('withClaimTx rolls the claim back unless the pass committed it', async () => {
  const { withClaimTx } = await import('../workers/settlement/helper/claimTx.mjs');

  let db = fakeDb();
  assert.equal(await withClaimTx(db, async (claim) => { const t = await claim.open(); await t.commit(); return 'ok'; }), 'ok');
  assert.deepEqual(db.log, ['open', 'commit']);

  db = fakeDb(); // crash / failed credit between claim and commit
  await assert.rejects(withClaimTx(db, async (claim) => { await claim.open(); throw new Error('wallet down'); }), /wallet down/);
  assert.deepEqual(db.log, ['open', 'rollback']);

  db = fakeDb(); // early return after the claim (already settled)
  await withClaimTx(db, async (claim) => { await claim.open(); return { settled: true }; });
  assert.deepEqual(db.log, ['open', 'rollback']);

  db = fakeDb(); // returned before claiming (not declared yet): no transaction at all
  await withClaimTx(db, async () => ({ requeue: true }));
  assert.deepEqual(db.log, []);
});

// settlementv2 starts the worker on import, so its wiring is checked in the source.
test('settlementv2 claims and credits in the same transaction and commits before the follow-up writes', () => {
  const src = fs.readFileSync(path.join(__dirname, '../workers/settlement/sportsbet/betresult/settlementv2.mjs'), 'utf8');
  const body = (name, next) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf(`async function ${next}(`));
  for (const [name, next] of [['processMobmGroupClaimed', 'processnonfancy'], ['processnonfancyClaimed', 'processFanBet'], ['initiateRefund', 'writeReport']]) {
    const fn = body(name, next);
    assert.match(fn, /status: \{ \[Op2\.in\]: \["open", "manual"\] \} \}, transaction: claimTx \}/, `${name}: claim in claimTx`);
    assert.match(fn, /applyWalletDeltaWithLedger\(user_id, \{[\s\S]*?transaction: claimTx\s*\}\);/, `${name}: credit in claimTx`);
    const commit = fn.indexOf('await claimTx.commit();');
    assert.ok(commit > fn.indexOf('applyWalletDeltaWithLedger('), `${name}: commit after the credit`);
  }
  for (const name of ['processMobmGroupClaimed', 'processnonfancyClaimed']) {
    const fn = body(name, name === 'processMobmGroupClaimed' ? 'processnonfancy' : 'processFanBet');
    // the follow-up `fixed: 1` update touches the claimed rows from another connection, so it must come after the commit
    assert.ok(fn.indexOf('await claimTx.commit();') < fn.indexOf('await SportsBet_default.update({ fixed: 1'), `${name}: commit before fixed update`);
    assert.match(fn, /Error updating wallet[\s\S]{0,200}throw err;/, `${name}: a failed credit rolls the claim back`);
  }
});

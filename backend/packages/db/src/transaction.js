'use strict';

const { Sequelize } = require('sequelize');

/**
 * Transaction helpers.
 *
 * Every balance change in this platform runs through `withTransaction`. The
 * rules it encodes:
 *
 *   - one connection per transaction (never share a client across requests)
 *   - commit on return, roll back on throw, always release
 *   - serialization failures and deadlocks are retried, because under betting
 *     load two players hitting the same row is normal, not exceptional
 *   - a nested call joins the outer transaction instead of opening a second
 *     one, so a service method is safe to call from inside another
 */

/** Postgres error codes worth retrying: serialization failure and deadlock. */
const RETRYABLE_CODES = new Set(['40001', '40P01']);

async function withTransaction(sequelize, fn, options = {}) {
  const { transaction: existing, isolationLevel, retries = 3, logger } = options;

  // Already inside a transaction — reuse it so the caller's atomicity holds.
  if (existing) return fn(existing);

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await sequelize.transaction(
        { ...(isolationLevel ? { isolationLevel } : {}) },
        async (transaction) => fn(transaction)
      );
    } catch (error) {
      lastError = error;
      const code = error?.parent?.code || error?.original?.code;

      if (!RETRYABLE_CODES.has(code) || attempt === retries) throw error;

      // Back off with jitter so two conflicting writers do not retry in lockstep.
      const delay = 2 ** (attempt - 1) * 25 + Math.floor(Math.random() * 25);
      logger?.warn({ code, attempt, retries }, `Transaction conflict — retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * SELECT ... FOR UPDATE on a single row.
 *
 * This is the lock that makes concurrent betting safe: read the balance, hold
 * the row until commit, so two simultaneous bets cannot both see the same
 * starting balance and both succeed. Read-then-write without it is the classic
 * way to let a player spend the same funds twice.
 */
async function lockRow(model, where, transaction, options = {}) {
  if (!transaction) throw new Error('lockRow requires an active transaction');
  return model.findOne({
    where,
    transaction,
    lock: transaction.LOCK.UPDATE,
    // Never wait behind another lock holder indefinitely when the caller says so.
    ...(options.skipLocked ? { skipLocked: true } : {}),
    ...options,
  });
}

/**
 * Lock several rows in a deterministic order.
 *
 * Two transfers running in opposite directions (A->B and B->A) deadlock if each
 * grabs its "own" row first. Sorting the keys means every transaction takes the
 * locks in the same order, so one simply waits instead of both dying.
 */
async function lockRowsInOrder(model, keyName, keys, transaction, options = {}) {
  if (!transaction) throw new Error('lockRowsInOrder requires an active transaction');
  const ordered = [...new Set(keys)].sort((a, b) => String(a).localeCompare(String(b)));

  const rows = [];
  for (const key of ordered) {
    const row = await lockRow(model, { [keyName]: key }, transaction, options);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Advisory lock for work that must not run twice concurrently across processes
 * — settling an event, running a cron, closing a round. Unlike a row lock this
 * needs no row to exist, and it releases automatically at commit.
 */
async function withAdvisoryLock(sequelize, lockKey, fn, { transaction } = {}) {
  const numericKey = typeof lockKey === 'number' ? lockKey : hashToInt(String(lockKey));

  const run = async (tx) => {
    const [{ locked }] = await sequelize.query('SELECT pg_try_advisory_xact_lock(:key) AS locked', {
      replacements: { key: numericKey },
      type: Sequelize.QueryTypes.SELECT,
      transaction: tx,
    });
    if (!locked) return { acquired: false, result: null };
    return { acquired: true, result: await fn(tx) };
  };

  return transaction ? run(transaction) : withTransaction(sequelize, run);
}

/** Stable 32-bit hash so a string lock name maps to the same bigint every time. */
function hashToInt(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

module.exports = { withTransaction, lockRow, lockRowsInOrder, withAdvisoryLock, RETRYABLE_CODES };

'use strict';

const { Client } = require('pg');
const { EVENTS, PLATFORM_EVENTS, encode, roomForUser } = require('@ibitplay/socket');
const { WalletService, creditPayload } = require('../modules/wallet/wallet.service');

/**
 * Database change → player socket push.
 *
 * Migration 113 makes Postgres `pg_notify` on every committed change to a player's `credits` row
 * (`credits_changed`) and to their status / lock columns (`account_changed`), whichever service
 * wrote it — sports settlement, the casino engines, provider callbacks, admin screens. This holds
 * one dedicated connection that LISTENs and pushes to `user:<id>`:
 *
 *   credits_changed  → `C.CREDIT` with every balance (the event the wallet's own push uses)
 *   account_changed  → `accountUpdated` `{ reason: 'account' }`
 *
 * Only players with a socket open are pushed to, so an offline player costs no read. Notifications
 * are batched for FLUSH_MS, so a bet that touches the row three times is one read and one push.
 * WalletService also pushes `C.CREDIT` for its own moves; the second identical push is harmless.
 *
 * The LISTEN connection reconnects on its own. While it is down nothing is lost that matters: the
 * client re-reads on focus, and the next change pushes again.
 */
const FLUSH_MS = 300;
const RETRY_MS = 5000;

function startDbChanges({ container, io }) {
  const { logger } = container;
  const cfg = container.db.sequelize.config;
  const wallet = new WalletService(container);

  const pending = new Map();
  let flushTimer = null;
  let retryTimer = null;
  let client = null;
  let stopped = false;

  const online = (uid) => (io.sockets.adapter.rooms.get(roomForUser(uid))?.size ?? 0) > 0;

  async function flush() {
    flushTimer = null;
    const batch = [...pending];
    pending.clear();

    for (const [uid, kinds] of batch) {
      if (!online(uid)) continue;
      const room = roomForUser(uid);
      try {
        if (kinds.has('balance')) {
          const balances = await wallet.getBalances(uid);
          io.to(room).emit(EVENTS.CREDIT, encode(creditPayload(balances)));
        }
        if (kinds.has('account')) io.to(room).emit(PLATFORM_EVENTS.ACCOUNT_UPDATED, encode({ reason: 'account' }));
      } catch (error) {
        logger.warn({ err: error.message, userId: uid }, 'Could not push a database change to the player');
      }
    }
  }

  function queue(uid, kind) {
    if (!/^\d+$/.test(String(uid))) return;
    const kinds = pending.get(uid) ?? new Set();
    kinds.add(kind);
    pending.set(uid, kinds);
    flushTimer ??= setTimeout(flush, FLUSH_MS);
  }

  async function connect() {
    const own = new Client({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.username,
      password: cfg.password,
    });
    client = own;

    own.on('notification', (msg) => {
      if (msg.channel === 'credits_changed') queue(msg.payload, 'balance');
      else if (msg.channel === 'account_changed') queue(msg.payload, 'account');
    });
    own.on('error', (error) => retry(own, error));
    own.on('end', () => retry(own));

    await own.connect();
    await own.query('LISTEN credits_changed');
    await own.query('LISTEN account_changed');
    logger.info('Listening for database changes to push to players');
  }

  function retry(from, error) {
    if (stopped || from !== client) return;
    client = null;
    logger.warn({ err: error?.message }, 'Database change listener dropped; reconnecting');
    from.removeAllListeners('notification');
    from.end().catch(() => {});
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      connect().catch((err) => retry(client, err));
    }, RETRY_MS);
  }

  connect().catch((error) => retry(client, error));

  return {
    async close() {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(flushTimer);
      await client?.end().catch(() => {});
    },
  };
}

module.exports = { startDbChanges };

'use strict';

const { mssports } = require('../../lib/mssports');

/**
 * The player's balance room — mssports `setupBetsSocket` (api/bets.api.js), unchanged.
 *
 *  client → 'authenticate' {userId}      join room user_<id>
 *  client → 'getBalance' / 'subscribeBalance' / 'unsubscribeBalance'
 *  server → 'balanceUpdate' { userId, balance: { inr_balance, exposure } }
 *
 * Workers publish balance pushes on Redis 'socket:balance_updates'; this process relays them to
 * room user_<id> — the relay TENEXCH had inline in server.js.
 */
function setupBetsSocket(io) {
  const { setIO, setupSocketHandlers, BALANCE_UPDATES_CHANNEL, redisClient } = mssports();
  setIO(io);
  setupSocketHandlers(io);

  // A subscriber-mode ioredis client can't run other commands, so the relay
  // needs its own duplicate connection.
  // No command timeout on the subscriber (the core client has one): it waits for messages by design.
  const balanceUpdatesSub = redisClient.duplicate({ commandTimeout: 0, maxRetriesPerRequest: null });
  balanceUpdatesSub.subscribe(BALANCE_UPDATES_CHANNEL).catch((err) => {
    console.error('❌ Failed to subscribe to balance updates channel:', err.message);
  });
  balanceUpdatesSub.on('message', (channel, message) => {
    if (channel !== BALANCE_UPDATES_CHANNEL) return;
    try {
      const payload = JSON.parse(message);
      if (payload && payload.userId != null) {
        io.to(`user_${payload.userId}`).emit('balanceUpdate', payload);
      }
    } catch (err) {
      console.error('❌ Bad balance update payload from worker:', err.message);
    }
  });
  return balanceUpdatesSub;
}

module.exports = { setupBetsSocket };

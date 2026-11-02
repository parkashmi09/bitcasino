#!/usr/bin/env node
'use strict';

/**
 * Set one player's lifetime wager (USD) — local testing of VIP levels and the withdrawal rollover.
 *
 *   node scripts/set-player-wager.js <username>            show the current wager
 *   node scripts/set-player-wager.js <username> <usd>      set it (e.g. 5000)
 *
 * It writes `userwager.wager`, which both read: VIP rank (1 XP = $1 wagered, against the admin's
 * thresholds) and the withdrawal check (deposits × multiplier must be wagered). Bet history is not
 * touched. Level-up rewards are keyed per level, so moving down and back up never pays one twice.
 */

const { connect } = require('@ibitplay/db');
const { loadEnv, coercers, dbEnvShape, createLogger } = require('@ibitplay/common');

async function main() {
  const [username, amount] = process.argv.slice(2);
  if (!username) throw new Error('usage: node scripts/set-player-wager.js <username> [usd]');
  if (amount !== undefined && !/^\d+(\.\d{1,8})?$/.test(amount)) throw new Error('usd must be a plain number, e.g. 5000');

  const config = loadEnv({ ...dbEnvShape, NODE_ENV: coercers.str('development') }, { serviceDir: process.cwd() });
  const db = await connect({ config, logger: createLogger({ name: 'set-player-wager', level: 'error' }), service: 'user-service' });
  const q = (sql, replacements) => db.sequelize.query(sql, { replacements, type: 'SELECT' });
  try {
    const [user] = await q('SELECT id, name FROM users WHERE name = :name', { name: username });
    if (!user) throw new Error(`no player named ${username}`);
    const [row] = await q('SELECT wager FROM userwager WHERE uid = :id', { id: user.id });
    console.log(`database ${config.DB_NAME}: ${user.name} (${user.id}) wager now ${row?.wager ?? '0 (no row)'} USD`);
    if (amount === undefined) return;

    await db.sequelize.query(
      'INSERT INTO userwager (uid, wager) VALUES (:id, :wager) ON CONFLICT (uid) DO UPDATE SET wager = EXCLUDED.wager',
      { replacements: { id: user.id, wager: amount } }
    );
    console.log(`set to ${amount} USD — reload /vip or /loyalty, or try a withdrawal`);
  } finally {
    await db.sequelize.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

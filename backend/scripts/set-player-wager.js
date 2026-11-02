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
 * touched. Then, like a settled bet, it asks user-service to process the change
 * (`POST /internal/user/vip/on-wager`): level-up bonuses for every level gained, rank-up rewards to
 * claim, and the card's rakeback rate. That needs the backend running; level rewards are keyed per
 * level, so moving down and back up never pays one twice.
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
    console.log(`set to ${amount} USD`);
    await processVip({ userId: user.id, previousWager: String(row?.wager ?? '0'), newWager: amount });
    console.log('reload /vip or /loyalty, or try a withdrawal');
  } finally {
    await db.sequelize.close();
  }
}

/** The VIP side of a wager change, as a settled bet triggers it (casino-service's grant). */
async function processVip(body) {
  const port = process.env.USER_SERVICE_PORT || '4001';
  const key = process.env.INTERNAL_KEY_CASINO_SERVICE || process.env.INTERNAL_API_KEY;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/internal/user/vip/on-wager`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': key, 'x-internal-service': 'casino-service' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`VIP not processed (${res.status} ${json?.error?.code ?? ''}) — level rewards follow the next settled bet`);
      return;
    }
    const d = json.data ?? {};
    console.log(`VIP processed: rakeback rate ${d.rate ?? '-'}, level-up rewards ${JSON.stringify(d.granted ?? d.awarded ?? d.levelUps ?? d)}`.slice(0, 400));
  } catch {
    console.log(`user-service not reachable on :${port} — wager saved; start the backend and re-run to pay level rewards`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

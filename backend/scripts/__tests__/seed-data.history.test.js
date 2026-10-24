'use strict';

/**
 * `--history`, end to end, against the TEST database only.
 *
 *   TEST_DB_NAME=ibitplay_test node --test --test-concurrency=1 scripts/__tests__/seed-data.history.test.js
 *
 * Runs the real CLI (`--demo --skip bootstrap --history 21`) as a child process and checks:
 *
 *   - the history rows span the window (first day … today), on many days, in order
 *   - no single day dominates the wager chart: the VIP cast reaches its cards through
 *     rounds spread over the window, not one lump on seed day, and still ends on them
 *   - every demo wallet equals the sum of its ledger (and the CLI's own reconcile passed)
 *   - a second `--history` writes nothing
 *   - `--reset-demo --yes` removes every history row, while non-demo rows written
 *     DURING the history run (a real player playing at the same moment) keep their
 *     timestamps through the backdating and survive the reset
 *
 * Leaves the database without demo rows (it resets before and after).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { QueryTypes } = require('sequelize');
const { createSequelize } = require('@ibitplay/db');
const { money, resolveVipLadder } = require('@ibitplay/common');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/seed-data.js');
const { CURRENCY_COLUMN } = require(path.join(ROOT, 'services/user/src/modules/wallet/wallet.constants'));

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const DB = {
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: String(process.env.DB_PORT || 5432),
  DB_NAME: TEST_DB,
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
};

const DAYS = 21;
/** The documented VIP cast: name → index of its card on the site's ladder (seed-data.js DIRECT_PLAYERS). */
const VIP_CAST = { demo_vip_wood: 0, demo_vip_bronze: 1, demo_vip_silver: 2, demo_vip_gold: 3 };
/** The busiest day's USD wager may be at most this many times the median active day's. */
const MAX_DAY_OVER_MEDIAN = 5;
const DEMO = "LIKE 'demo\\_%'";
const DEMO_IDS = `(SELECT id FROM users WHERE name ${DEMO})`;
const DEMO_TEXT_IDS = `(SELECT id::text FROM users WHERE name ${DEMO})`;

/** Every table the history writes, with its owner column (text or bigint). */
const HISTORY_TABLES = [
  ['credits_ledger', 'user_id', DEMO_TEXT_IDS],
  ['wallet_history', 'uid', DEMO_IDS],
  ['wager_activity', 'user_id', DEMO_IDS],
  ['bets', 'uid', DEMO_IDS],
  ['game_transactions', 'user_id', DEMO_IDS],
  ['gis_transactions', 'user_id', DEMO_IDS],
  ['"SportsBet"', 'user_id', DEMO_IDS],
  ['ccdeposit', 'userid', DEMO_TEXT_IDS],
  ['fiat_deposits', 'user_id', DEMO_IDS],
  ['fiat_withdrawals', 'uid', DEMO_IDS],
  ['withdrawals', 'uid', DEMO_IDS],
  ['tips', 'from_user_id', DEMO_IDS],
  ['player_bonuses', 'user_id', DEMO_IDS],
  ['rakeback_accruals', 'user_id', DEMO_IDS],
  ['rewards', 'owner_id', DEMO_IDS],
  ['vault_transactions', 'userid', DEMO_IDS],
  ['wager_reversals', 'user_id', DEMO_IDS],
];

test('demo history: spans the window, reconciles, is not doubled, resets', { timeout: 20 * 60_000 }, async (t) => {
  if (!/test/i.test(TEST_DB)) {
    t.skip(`TEST_DB_NAME "${TEST_DB}" does not look like a test database — refusing`);
    return;
  }

  const sequelize = createSequelize({ ...DB, DB_PORT: Number(DB.DB_PORT), DB_SCHEMA: 'public', SERVICE_NAME: 'seed-history-test' });
  try {
    await sequelize.query('SELECT 1');
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    await sequelize.close().catch(() => {});
    return;
  }
  const q = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-history-'));
  const env = {
    ...process.env,
    ...DB,
    NODE_ENV: 'test',
    BCRYPT_ROUNDS: '4',
    LOG_LEVEL: 'warn',
    SEED_SERVICE_LOG_LEVEL: 'error',
    DEMO_CREDENTIALS_FILE: path.join(dir, 'demo-credentials.md'),
  };
  const cli = (...argv) => {
    const out = spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { code: out.status, stdout: `${out.stdout}${out.stderr}` };
  };
  /** The same, but async — so the test can write rows while it runs. */
  const cliAsync = (...argv) => new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...argv], { cwd: ROOT, env });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stdout += d; });
    child.on('close', (code) => resolve({ code, stdout }));
  });

  const counts = async () => {
    const out = {};
    for (const [table, column, ids] of HISTORY_TABLES) {
      out[table] = (await q(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} IN ${ids}`))[0].n;
    }
    out.users = (await q(`SELECT COUNT(*)::int AS n FROM users WHERE name ${DEMO}`))[0].n;
    return out;
  };

  // Non-demo rows: an id no user has (no FK on these tables), tagged for cleanup.
  const [{ id: outsider }] = await q('SELECT COALESCE(MAX(id), 0) + 7000000 AS id FROM users');
  const tag = `demo-history-test-${Date.now()}`;
  const outsiderRows = [];
  const writeOutsider = async (i) => {
    const [ledger] = await q(
      `INSERT INTO credits_ledger (user_id, currency, amount, reason, description, idempotency_key, created_at)
       VALUES (:uid, 'INR', 1, 'TEST', :tag, :key, now()) RETURNING id, created_at::text AS at`,
      { uid: String(outsider), tag, key: `${tag}:${i}` }
    );
    outsiderRows.push({ table: 'credits_ledger', id: ledger.id, at: ledger.at });
    const [bet] = await q(
      `INSERT INTO bets (game, gid, uid, amount, coin, profit, created, name) VALUES ('crash', 1, :uid, 1, 'inr', 0, now(), :tag)
       RETURNING id, created::text AS at`,
      { uid: outsider, tag }
    );
    outsiderRows.push({ table: 'bets', id: bet.id, at: bet.at, column: 'created' });
    const [sb] = await q(
      `INSERT INTO "SportsBet" (user_id, match_title, stake_amount, status, result_status, created_at, updated_at)
       VALUES (:uid, :tag, 1, 'open', 'pending', now(), now()) RETURNING id, created_at::text AS at`,
      { uid: outsider, tag }
    );
    outsiderRows.push({ table: '"SportsBet"', id: sb.id, at: sb.at });
  };

  const cleanup = async () => {
    await sequelize.query('DELETE FROM credits_ledger WHERE description = :tag', { replacements: { tag } });
    await sequelize.query('DELETE FROM bets WHERE name = :tag', { replacements: { tag } });
    await sequelize.query('DELETE FROM "SportsBet" WHERE match_title = :tag', { replacements: { tag } });
  };

  t.after(async () => {
    try {
      cli('--reset-demo', '--yes');
      await cleanup();
    } finally {
      await sequelize.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const pre = cli('--reset-demo', '--yes');
  assert.equal(pre.code, 0, pre.stdout);

  // ── The run, with a "real player" writing rows the whole time ──────────
  let writing = true;
  let i = 0;
  const writer = (async () => {
    while (writing) {
      await writeOutsider((i += 1));
      await new Promise((r) => setTimeout(r, 150));
    }
  })();
  const run = await cliAsync('--demo', '--skip', 'bootstrap', '--history', String(DAYS));
  writing = false;
  await writer;
  assert.equal(run.code, 0, run.stdout);

  await t.test('history rows span the window, on many days, in order', async () => {
    const [ledger] = await q(
      `SELECT COUNT(*)::int AS n, MIN(created_at) AS first, MAX(created_at) AS last,
              COUNT(DISTINCT date_trunc('day', created_at))::int AS days,
              COUNT(*) FILTER (WHERE created_at > now() - interval '2 minutes')::int AS fresh
         FROM credits_ledger WHERE idempotency_key LIKE 'demo-history:%' AND user_id IN ${DEMO_TEXT_IDS}`
    );
    assert.ok(ledger.n > 200, `history ledger rows: ${ledger.n}`);
    assert.equal(ledger.fresh, 0, 'every history row was backdated');
    const ageDays = (d) => (Date.now() - new Date(d).getTime()) / 86_400_000;
    assert.ok(ageDays(ledger.first) > DAYS - 4 && ageDays(ledger.first) <= DAYS + 0.1, `first row ${ledger.first}`);
    assert.ok(ageDays(ledger.last) < 1, `last row ${ledger.last}`);
    assert.ok(ledger.days >= DAYS * 0.7, `active on ${ledger.days} of ${DAYS} days`);

    // Every chart table has rows, all inside the window.
    for (const [table, column, ids] of HISTORY_TABLES) {
      if (['tips', 'vault_transactions', 'rewards', 'wager_reversals'].includes(table)) continue; // may be sparse in 21 days
      const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} IN ${ids}`);
      assert.ok(n > 0, `${table} has history rows`);
    }
    const [{ reversed }] = await q(`SELECT COUNT(*)::int AS reversed FROM wager_activity WHERE reversed_amount > 0 AND user_id IN ${DEMO_IDS}`);
    assert.ok(reversed > 0, 'some stakes were refunded through WagerActivityService.reverse');

    // Signups spread over the period.
    const [signups] = await q(
      `SELECT COUNT(*)::int AS n, COUNT(DISTINCT date_trunc('day', created))::int AS days
         FROM users WHERE name LIKE 'demo\\_h%'`
    );
    assert.ok(signups.n >= 8 && signups.days >= 6, `signups: ${signups.n} on ${signups.days} days`);
    const [{ cast }] = await q(
      `SELECT COUNT(*)::int AS cast FROM users WHERE name ${DEMO} AND name NOT LIKE 'demo\\_h%' AND created > now() - interval '1 day'`
    );
    assert.equal(cast, 0, 'no demo signup left on today (the base cast was backdated too)');

    // Order across tables.
    const [order] = await q(
      `WITH f AS (
         SELECT l.user_id, MIN(l.created_at) FILTER (WHERE reason = 'DEPOSIT') AS dep,
                MIN(l.created_at) FILTER (WHERE reason = 'BET_STAKE') AS bet
           FROM credits_ledger l WHERE user_id IN (SELECT id::text FROM users WHERE name LIKE 'demo\\_h%') GROUP BY 1)
       SELECT COUNT(*) FILTER (WHERE bet < dep)::int AS bet_before_deposit,
              (SELECT COUNT(*)::int FROM "SportsBet" WHERE user_id IN ${DEMO_IDS} AND updated_at < created_at) AS settled_before_placed,
              (SELECT COUNT(*)::int FROM users u JOIN credits_ledger l ON l.user_id = u.id::text
                WHERE u.name LIKE 'demo\\_h%' AND l.created_at < u.created) AS before_signup,
              (SELECT COUNT(*)::int FROM fiat_withdrawals w
                WHERE w.uid IN ${DEMO_IDS} AND w.date < (SELECT MIN(created_at) FROM credits_ledger
                                                        WHERE reason = 'DEPOSIT' AND user_id = w.uid::text)) AS withdrawal_before_deposit
         FROM f`
    );
    assert.deepEqual(order, { bet_before_deposit: 0, settled_before_placed: 0, before_signup: 0, withdrawal_before_deposit: 0 });

    // Every status the cashier charts break down by.
    const statuses = async (sql) => new Set((await q(sql)).map((r) => r.s));
    const fiat = await statuses(`SELECT DISTINCT status AS s FROM fiat_deposits WHERE user_id IN ${DEMO_IDS}`);
    for (const s of ['approved', 'pending', 'rejected']) assert.ok(fiat.has(s), `fiat deposit ${s}`);
    const crypto = await statuses(`SELECT DISTINCT status AS s FROM ccdeposit WHERE userid IN ${DEMO_TEXT_IDS}`);
    assert.ok(crypto.has('Success'), 'crypto deposits credited through the webhook');
    const sports = await statuses(`SELECT DISTINCT result_status AS s FROM "SportsBet" WHERE user_id IN ${DEMO_IDS}`);
    assert.ok(sports.has('won') && sports.has('loss'), 'sports bets with results');
  });

  await t.test('no single day dominates the wager chart', async () => {
    // Site days (IST), as the plan draws them. Every demo player's turnover, base cast included.
    const days = await q(
      `SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day, SUM(usd_amount)::float8 AS usd
         FROM wager_activity WHERE user_id IN ${DEMO_IDS} GROUP BY 1 ORDER BY 1`
    );
    assert.ok(days.length >= DAYS * 0.7, `wagers on ${days.length} of ${DAYS} days`);
    const sorted = days.map((d) => d.usd).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const top = days.reduce((a, b) => (b.usd > a.usd ? b : a));
    const ratio = top.usd / median;
    assert.ok(
      ratio <= MAX_DAY_OVER_MEDIAN,
      `${top.day}: $${top.usd.toFixed(2)} wagered, ${ratio.toFixed(1)}x the median active day ($${median.toFixed(2)})`
    );
  });

  await t.test('the VIP cast still reaches its cards, gradually', async () => {
    const ladder = await resolveVipLadder({
      SiteFeature: { findByPk: async () => (await q("SELECT variant FROM site_features WHERE feature = 'vip'"))[0] ?? null },
    });
    const cards = [];
    for (const band of ladder.levels) if (!cards.includes(band.card)) cards.push(band.card);
    const vip = await q(
      `SELECT u.id, u.name, w.wager::text AS wager, u.rakeback::text AS rate, u.rakeamount::text AS accrued
         FROM users u JOIN userwager w ON w.uid = u.id WHERE u.name IN (:names)`,
      { names: Object.keys(VIP_CAST) }
    );
    assert.equal(vip.length, 4);
    for (const v of vip) {
      assert.equal(ladder.levelFor(v.wager).card, cards[VIP_CAST[v.name]], `${v.name} ($${v.wager}) on card #${VIP_CAST[v.name] + 1}`);
      assert.ok(money.gt(v.rate, '0'), `${v.name} has a rakeback rate`);
      if (v.name === 'demo_vip_silver') assert.ok(money.lte(v.accrued, '0'), 'demo_vip_silver claimed its rakeback');
      else assert.ok(money.gt(v.accrued, '0'), `${v.name} has rakeback to claim`);
    }
    // No lump: the turnover came in history rounds, on many days, all of it backdated.
    const [spread] = await q(
      `SELECT COUNT(*) FILTER (WHERE ref LIKE 'demo-seed:%:vip')::int AS lump,
              COUNT(*) FILTER (WHERE ref LIKE 'demo-history:%')::int AS rounds,
              (SELECT MIN(d)::int FROM (SELECT COUNT(DISTINCT (created_at AT TIME ZONE 'Asia/Kolkata')::date) AS d
                                          FROM wager_activity WHERE user_id IN (:ids) GROUP BY user_id) x) AS fewest_days,
              COUNT(*) FILTER (WHERE created_at > now() - interval '2 minutes')::int AS fresh
         FROM wager_activity WHERE user_id IN (:ids)`,
      { ids: vip.map((v) => Number(v.id)) }
    );
    assert.equal(spread.lump, 0, 'no one-shot VIP wager on seed day');
    assert.ok(spread.rounds >= 4 * 5, `VIP history rounds: ${spread.rounds}`);
    assert.ok(spread.fewest_days >= 5, `each VIP player wagered on at least 5 days (fewest: ${spread.fewest_days})`);
    assert.equal(spread.fresh, 0, 'every VIP round was backdated');
    const [{ early }] = await q(
      `SELECT COUNT(*)::int AS early FROM wager_activity w JOIN users u ON u.id = w.user_id
        WHERE u.name IN (:names) AND w.created_at < u.created`,
      { names: Object.keys(VIP_CAST) }
    );
    assert.equal(early, 0, 'no VIP round before its player signed up');
  });

  await t.test('every demo wallet equals the sum of its ledger', async () => {
    assert.match(run.stdout, /WalletService\.reconcile: \d+ wallet\(s\) of \d+ demo player\(s\) balanced/);
    const cols = Object.entries(CURRENCY_COLUMN);
    const players = await q(
      `SELECT u.id, u.name, ${cols.map(([, c]) => `COALESCE(c.${c}, 0)::text AS ${c}`).join(', ')}
         FROM users u JOIN credits c ON c.uid = u.id WHERE u.name ${DEMO}`
    );
    const sums = await q(
      `SELECT user_id, upper(currency) AS currency, SUM(amount)::text AS total
         FROM credits_ledger WHERE user_id IN (:ids) GROUP BY 1, 2`,
      { ids: players.map((p) => String(p.id)) }
    );
    const ledger = new Map(sums.map((s) => [`${s.user_id}|${s.currency}`, s.total]));
    for (const p of players) {
      for (const [code, col] of cols) {
        const balance = money.fromStored(p[col]);
        const total = money.fromStored(ledger.get(`${p.id}|${code}`) ?? '0');
        assert.equal(balance, total, `${p.name} ${code}: balance ${balance} vs ledger ${total}`);
      }
    }
  });

  await t.test('coin payouts go through the crypto queue, each with its ledger hold', async () => {
    // The bank form is for fiat; a USDT payout on it would show under "Bank" on the fiat chart.
    const [{ n: coinOnBank }] = await q(
      `SELECT COUNT(*)::int AS n FROM fiat_withdrawals WHERE uid IN ${DEMO_IDS} AND UPPER(currency) NOT IN ('INR', 'EUR')`
    );
    assert.equal(coinOnBank, 0, 'no coin payout on the bank rail');

    const rows = await q(
      `SELECT w.id, w.status, w.amount::text AS amount, w.coin, w.date,
              (SELECT COUNT(*)::int FROM credits_ledger l WHERE l.user_id = w.uid::text AND l.reason = 'WITHDRAWAL'
                  AND l.meta->>'refType' = 'CRYPTO_WITHDRAWAL' AND l.meta->>'refId' = w.id::text AND l.amount = -w.amount) AS holds,
              (SELECT COUNT(*)::int FROM credits_ledger l WHERE l.user_id = w.uid::text AND l.reason = 'WITHDRAWAL_REVERSAL'
                  AND l.meta->>'refId' = w.id::text) AS refunds
         FROM withdrawals w WHERE w.uid IN ${DEMO_IDS}`
    );
    assert.ok(rows.length > 0, 'crypto withdrawals were seeded');
    for (const r of rows) {
      // `decide` refunds in `row.coin`; a lower-case ledger currency would not reconcile.
      assert.equal(r.coin, r.coin.toUpperCase(), `withdrawal #${r.id}: coin stored upper-case`);
      assert.equal(r.holds, 1, `withdrawal #${r.id}: one WITHDRAWAL hold`);
      assert.equal(r.refunds, r.status === 'Rejected' ? 1 : 0, `withdrawal #${r.id} (${r.status}): refund iff rejected`);
      assert.ok(new Date(r.date) < new Date(Date.now() - 60_000), `withdrawal #${r.id} was backdated`);
    }
    assert.ok(rows.some((r) => r.status === 'Sent'), `a payout reached Sent (${[...new Set(rows.map((r) => r.status))]})`);
  });

  await t.test('a --demo re-run days later replays the house funding instead of failing', async () => {
    // The wallet replays a key for 48 h only; age the base cast's house credits past that.
    await sequelize.query(
      `UPDATE credits_ledger SET created_at = created_at - interval '3 days'
        WHERE idempotency_key LIKE 'demo-seed:fund:%' AND user_id IN ${DEMO_TEXT_IDS}`
    );
    const out = cli('--only', 'direct,tips,vault');
    assert.equal(out.code, 0, out.stdout);
    assert.doesNotMatch(out.stdout, /duplicate key|✗/);
  });

  await t.test('non-demo rows written during the run keep their timestamps', async () => {
    assert.ok(outsiderRows.length >= 6, `outsider rows written: ${outsiderRows.length}`);
    for (const row of outsiderRows) {
      const column = row.column ?? 'created_at';
      const [now] = await q(`SELECT ${column}::text AS at FROM ${row.table} WHERE id = :id`, { id: row.id });
      assert.equal(now?.at, row.at, `${row.table} #${row.id} was not moved`);
    }
  });

  await t.test('a second --history writes nothing', async () => {
    const before = await counts();
    const again = cli('--history', String(DAYS));
    assert.equal(again.code, 0, again.stdout);
    assert.match(again.stdout, /not generated again/);
    assert.deepEqual(await counts(), before);
  });

  await t.test('--reset-demo --yes removes every history row; non-demo rows survive', async () => {
    const ids = (await q(`SELECT id FROM users WHERE name ${DEMO}`)).map((r) => String(r.id));
    const out = cli('--reset-demo', '--yes');
    assert.equal(out.code, 0, out.stdout);
    for (const [table, column] of HISTORY_TABLES) {
      const textual = ['credits_ledger', 'ccdeposit'].includes(table);
      const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} IN (:ids)`, { ids: textual ? ids : ids.map(Number) });
      assert.equal(n, 0, `${table}: demo rows left after the reset`);
    }
    const [{ n: users }] = await q(`SELECT COUNT(*)::int AS n FROM users WHERE name ${DEMO} OR email ${DEMO}`);
    assert.equal(users, 0);
    for (const row of outsiderRows) {
      const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM ${row.table} WHERE id = :id`, { id: row.id });
      assert.equal(n, 1, `${row.table} #${row.id} (not demo) survived the reset`);
    }
  });
});

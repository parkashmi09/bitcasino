'use strict';

/**
 * The demo seed, end to end, against the TEST database only.
 *
 *   TEST_DB_NAME=ibitplay_test node --test scripts/__tests__/seed-data.demo.test.js
 *
 * Runs the real CLI (`scripts/seed-data.js`) as a child process — the same
 * thing a developer types — and checks what it left behind:
 *
 *   - every demo wallet equals the sum of its own ledger, per currency
 *   - every tip has its TIP_SENT and TIP_RECEIVED ledger rows, and nothing else does
 *   - each promised state exists (KYC, bonuses, commission, cashier queues, vault, VIP…)
 *   - no password ever reaches stdout; each account has its own, in the file
 *   - a second run writes nothing and rotates nothing
 *   - `--reset-demo` is a dry run without `--yes`, and with it removes every demo_ row
 *
 * `bootstrap` is skipped: the shared test database carries roles other suites
 * create (an "Executive" at a non-ladder id), which seeder 001 cannot insert
 * over. The demo `staff` dataset resolves the ladder itself.
 *
 * Leaves the database without demo rows (it resets before and after).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

const DEMO = "LIKE 'demo\\_%'";

test('demo seed: seeds, reconciles, is idempotent, resets', { timeout: 15 * 60_000 }, async (t) => {
  // Never anything but a test database: this test deletes demo rows.
  if (!/test/i.test(TEST_DB)) {
    t.skip(`TEST_DB_NAME "${TEST_DB}" does not look like a test database — refusing`);
    return;
  }

  const sequelize = createSequelize({ ...DB, DB_PORT: Number(DB.DB_PORT), DB_SCHEMA: 'public', SERVICE_NAME: 'seed-test' });
  try {
    await sequelize.query('SELECT 1');
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    await sequelize.close().catch(() => {});
    return;
  }
  const q = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-demo-'));
  const credentialsFile = path.join(dir, 'demo-credentials.md');

  const cli = (...argv) => {
    const out = spawnSync(process.execPath, [SCRIPT, ...argv], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...DB,
        NODE_ENV: 'test',
        BCRYPT_ROUNDS: '4', // fast hashes; the cost is not what this test is about
        LOG_LEVEL: 'warn',
        DEMO_CREDENTIALS_FILE: credentialsFile,
      },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: out.status, stdout: `${out.stdout}${out.stderr}` };
  };
  const seed = () => cli('--demo', '--skip', 'bootstrap');

  /** Rows of the credentials file: { kind, login, email, password, role, txn }. */
  const credentialRows = () => {
    if (!fs.existsSync(credentialsFile)) return [];
    return fs.readFileSync(credentialsFile, 'utf8').split('\n')
      .filter((line) => line.startsWith(`| ${DB.DB_NAME}@`))
      .map((line) => {
        const cells = line.split('|').slice(1, -1).map((v) => v.trim());
        return { kind: cells[1], login: cells[2], email: cells[3], password: cells[4], role: cells[5], txn: cells[6] };
      });
  };

  /** Per-table row counts of everything hanging off the demo cast, and every balance. */
  const snapshot = async () => {
    const ids = (await q(`SELECT id FROM users WHERE name ${DEMO}`)).map((r) => String(r.id));
    const staff = await q(`SELECT COUNT(*)::int AS n FROM staff WHERE name ${DEMO}`);
    if (!ids.length) return { users: 0, staff: staff[0].n };
    const count = async (sql) => (await q(sql, { ids, nids: ids.map(Number) }))[0].n;
    return {
      users: ids.length,
      staff: staff[0].n,
      ledger: await count('SELECT COUNT(*)::int AS n FROM credits_ledger WHERE user_id IN (:ids)'),
      tips: await count('SELECT COUNT(*)::int AS n FROM tips WHERE from_user_id IN (:nids) OR to_user_id IN (:nids)'),
      bonuses: await count('SELECT COUNT(*)::int AS n FROM player_bonuses WHERE user_id IN (:nids)'),
      wagers: await count('SELECT COUNT(*)::int AS n FROM wager_activity WHERE user_id IN (:nids)'),
      rewards: await count('SELECT COUNT(*)::int AS n FROM rewards WHERE owner_id IN (:nids)'),
      claimed: await count('SELECT COUNT(*)::int AS n FROM rewards WHERE owner_id IN (:nids) AND claimed'),
      vault: await count('SELECT COUNT(*)::int AS n FROM vault_pro WHERE userid IN (:nids)'),
      interest: await count('SELECT COUNT(*)::int AS n FROM vault_interest_history WHERE userid IN (:nids)'),
      deposits: await count('SELECT COUNT(*)::int AS n FROM fiat_deposits WHERE user_id IN (:nids)'),
      withdrawals: await count('SELECT COUNT(*)::int AS n FROM fiat_withdrawals WHERE uid IN (:nids)'),
      kyc: await count('SELECT COUNT(*)::int AS n FROM user_kyc WHERE user_id IN (:ids)'),
      notifications: await count('SELECT COUNT(*)::int AS n FROM user_notifications WHERE user_id IN (:nids)'),
      transfers: await count("SELECT COUNT(*)::int AS n FROM staff_transfers WHERE to_type = 'user' AND to_id IN (:nids)"),
      balances: JSON.stringify(await q('SELECT uid, inr::text, usdt::text, btc::text, eth::text FROM credits WHERE uid IN (:nids) ORDER BY uid', { nids: ids.map(Number) })),
    };
  };

  t.after(async () => {
    try {
      cli('--reset-demo', '--yes');
    } finally {
      await sequelize.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // A clean slate: earlier runs (or a developer) may have left demo rows.
  const pre = cli('--reset-demo', '--yes');
  assert.equal(pre.code, 0, pre.stdout);

  // ── First run ─────────────────────────────────────────────────────────
  const first = seed();
  assert.equal(first.code, 0, first.stdout);

  const accounts = credentialRows();
  await t.test('every created account has its own random password, on file only', () => {
    assert.equal(accounts.length, 29, 'staff 8 + agent-tree players 6 + direct players 15');
    const passwords = accounts.map((a) => a.password);
    assert.equal(new Set(passwords).size, passwords.length, 'no two accounts share a password');
    for (const a of accounts) {
      assert.ok(a.login.startsWith('demo_') && a.email.startsWith('demo_'), `${a.login} is demo_-prefixed`);
      assert.equal(a.password.length, 18);
      assert.ok(/[A-Z]/.test(a.password) && /[a-z]/.test(a.password) && /\d/.test(a.password), `${a.login}: password classes`);
    }
    // The whole point: nothing secret in the terminal.
    for (const secret of [...passwords, ...accounts.map((a) => a.txn).filter(Boolean)]) {
      assert.ok(!first.stdout.includes(secret), 'a password reached stdout');
    }
    assert.match(first.stdout, /29 demo account\(s\) created/);
    assert.equal(fs.statSync(credentialsFile).mode & 0o777, 0o600, 'credentials file is 0600');
  });

  await t.test('every demo wallet equals the sum of its ledger, per currency', async () => {
    const cols = Object.entries(CURRENCY_COLUMN);
    const players = await q(
      `SELECT u.id, u.name, ${cols.map(([, c]) => `COALESCE(c.${c}, 0)::text AS ${c}`).join(', ')}
         FROM users u JOIN credits c ON c.uid = u.id WHERE u.name ${DEMO}`
    );
    assert.equal(players.length, 21);
    const sums = await q(
      `SELECT user_id, upper(currency) AS currency, SUM(amount)::text AS total
         FROM credits_ledger WHERE user_id IN (:ids) GROUP BY 1, 2`,
      { ids: players.map((p) => String(p.id)) }
    );
    const ledger = new Map(sums.map((s) => [`${s.user_id}|${s.currency}`, s.total]));
    let nonZero = 0;
    for (const p of players) {
      for (const [code, col] of cols) {
        const balance = money.fromStored(p[col]);
        const total = money.fromStored(ledger.get(`${p.id}|${code}`) ?? '0');
        assert.equal(balance, total, `${p.name} ${code}: balance ${balance} vs ledger ${total}`);
        if (money.gt(balance, '0')) nonZero += 1;
      }
    }
    assert.ok(nonZero >= 20, 'the cast actually holds money');
  });

  await t.test('every tip has exactly its TIP_SENT and TIP_RECEIVED ledger rows', async () => {
    const tips = await q(
      `SELECT t.*, s.user_id AS s_user, s.amount::text AS s_amount, s.reason AS s_reason, s.currency AS s_cur,
              r.user_id AS r_user, r.amount::text AS r_amount, r.reason AS r_reason, r.currency AS r_cur
         FROM tips t
         JOIN users fu ON fu.id = t.from_user_id
         LEFT JOIN credits_ledger s ON s.id = t.from_ledger_id
         LEFT JOIN credits_ledger r ON r.id = t.to_ledger_id
        WHERE fu.name ${DEMO}`
    );
    assert.equal(tips.length, 4);
    for (const tip of tips) {
      const amount = money.fromStored(String(tip.amount));
      assert.equal(tip.s_reason, 'TIP_SENT');
      assert.equal(tip.s_user, String(tip.from_user_id));
      assert.equal(money.fromStored(tip.s_amount), money.toDecimalString(-money.toMinor(amount)));
      assert.equal(tip.r_reason, 'TIP_RECEIVED');
      assert.equal(tip.r_user, String(tip.to_user_id));
      assert.equal(money.fromStored(tip.r_amount), amount);
      assert.equal(tip.s_cur, tip.currency);
      assert.equal(tip.r_cur, tip.currency);
    }
    const [{ n }] = await q(
      `SELECT COUNT(*)::int AS n FROM credits_ledger l JOIN users u ON u.id::text = l.user_id
        WHERE u.name ${DEMO} AND l.reason IN ('TIP_SENT', 'TIP_RECEIVED')`
    );
    assert.equal(n, tips.length * 2, 'no TIP_* ledger row without a tip');
    const [{ notes }] = await q(
      `SELECT COUNT(*)::int AS notes FROM user_notifications n JOIN users u ON u.id = n.user_id
        WHERE u.name ${DEMO} AND n.type = 'tip_received'`
    );
    assert.equal(notes, tips.length, 'each receiver was notified');
  });

  await t.test('each promised state exists', async () => {
    const byName = async (name) => (await q('SELECT * FROM users WHERE name = :name', { name }))[0];

    // KYC
    const kyc = Object.fromEntries((await q(
      `SELECT u.name, k.status, k.rejection_reason FROM user_kyc k JOIN users u ON u.id::text = k.user_id WHERE u.name ${DEMO}`
    )).map((r) => [r.name, r]));
    assert.equal(kyc.demo_fresh, undefined, 'NotSubmitted = no row');
    assert.equal(kyc.demo_multicoin.status, 'Pending');
    assert.equal(kyc.demo_depositor.status, 'Verified');
    assert.equal(kyc.demo_kyc_rejected.status, 'Rejected');
    assert.ok(kyc.demo_kyc_rejected.rejection_reason, 'a rejection carries its reason');

    // Tips switched off
    const notips = await byName('demo_notips');
    const [cfg] = await q('SELECT tips_enabled FROM userconfig WHERE uid = :id', { id: notips.id });
    assert.equal(cfg.tips_enabled, false);

    // Multi-currency
    const multi = await byName('demo_multicoin');
    const [wallet] = await q('SELECT inr::text, usdt::text, btc::text, eth::text FROM credits WHERE uid = :id', { id: multi.id });
    for (const col of ['inr', 'usdt', 'btc', 'eth']) assert.ok(money.gt(money.fromStored(wallet[col]), '0'), `demo_multicoin holds ${col}`);

    // Bonuses: one completed (released to cash), one active
    const bonuses = await q(
      `SELECT pb.status, pb.release_ledger_id FROM player_bonuses pb JOIN users u ON u.id = pb.user_id WHERE u.name = 'demo_bonus' ORDER BY pb.id`
    );
    assert.deepEqual(bonuses.map((b) => b.status), ['completed', 'active']);
    assert.ok(bonuses[0].release_ledger_id, 'the completed bonus was paid to cash');

    // VIP on four different cards, with the matching rakeback rate
    // The site's ladder, read the way VipService reads it (site_features 'vip').
    const ladder = await resolveVipLadder({
      SiteFeature: { findByPk: async () => (await q("SELECT variant FROM site_features WHERE feature = 'vip'"))[0] ?? null },
    });
    const vip = await q(
      `SELECT u.name, w.wager, u.rakeback::text AS rate, u.rakeamount::text AS accrued
         FROM users u JOIN userwager w ON w.uid = u.id WHERE u.name LIKE 'demo\\_vip\\_%' ORDER BY w.wager::numeric`
    );
    assert.equal(vip.length, 4);
    const cardsSeen = vip.map((v) => ladder.levelFor(v.wager).card);
    assert.equal(new Set(cardsSeen).size, 4, `four cards: ${cardsSeen.join(', ')}`);
    for (const v of vip) assert.ok(money.gt(v.rate, '0'), `${v.name} has a rakeback rate`);
    // Without --history the cards still come from one seed-day wager each (the old way).
    const [{ lump }] = await q("SELECT COUNT(*)::int AS lump FROM wager_activity WHERE source = 'demo_seed' AND ref LIKE 'demo-seed:demo\\_vip\\_%:vip'");
    assert.equal(lump, 4, 'one lump VIP wager per VIP player');
    const silver = vip.find((v) => v.name === 'demo_vip_silver');
    assert.ok(money.lte(silver.accrued, '0'), 'demo_vip_silver claimed its rakeback');
    assert.ok(vip.filter((v) => v.name !== 'demo_vip_silver').every((v) => money.gt(v.accrued, '0')), 'the others have rakeback to claim');

    // Affiliate: 3 referees, commission claimed and unclaimed
    const [{ members }] = await q("SELECT COUNT(*)::int AS members FROM team WHERE ownername = 'demo_affiliate'");
    assert.equal(members, 3);
    const commission = await q("SELECT claimed FROM rewards WHERE ownername = 'demo_affiliate' AND type = 'commission'");
    assert.ok(commission.some((r) => r.claimed) && commission.some((r) => !r.claimed), 'claimed and unclaimed commission');

    // Cashier queues
    const deposits = new Set((await q(`SELECT DISTINCT d.status FROM fiat_deposits d JOIN users u ON u.id = d.user_id WHERE u.name ${DEMO}`)).map((r) => r.status));
    assert.deepEqual([...deposits].sort(), ['approved', 'pending', 'rejected']);
    const withdrawals = new Set((await q(`SELECT DISTINCT w.status FROM fiat_withdrawals w JOIN users u ON u.id = w.uid WHERE u.name ${DEMO}`)).map((r) => r.status));
    assert.deepEqual([...withdrawals].sort(), ['Approved', 'In Queue', 'Rejected']);

    // Vault: flexible + locked, each with interest
    const vault = await q(
      `SELECT v.lock_period, (SELECT COUNT(*)::int FROM vault_interest_history h WHERE h.deposit_id = v.id) AS interest
         FROM vault_pro v JOIN users u ON u.id = v.userid WHERE u.name = 'demo_vault'`
    );
    assert.equal(vault.length, 2);
    assert.ok(vault.every((v) => v.interest >= 1));

    // Saved payout accounts
    const [{ banks }] = await q("SELECT COUNT(*)::int AS banks FROM user_bank_accounts b JOIN users u ON u.id = b.user_id WHERE u.name = 'demo_depositor'");
    assert.equal(banks, 2);

    // Notifications: read and unread
    const reads = await q(`SELECT DISTINCT n.is_read FROM user_notifications n JOIN users u ON u.id = n.user_id WHERE u.name ${DEMO}`);
    assert.equal(reads.length, 2);

    // Staff tree and agent-tree players
    const [{ depth }] = await q(
      `SELECT h.depth FROM staff_hierarchy h
         JOIN staff a ON a.id = h.ancestor_id AND a.name = 'demo_superadmin'
         JOIN staff d ON d.id = h.descendant_id AND d.name = 'demo_agent'`
    );
    assert.equal(depth, 5, 'superadmin → admin → subadmin → supermaster → master → agent');
    const agentPlayers = await q(
      `SELECT u.name, s.name AS agent FROM users u JOIN staff s ON s.id = u.parent_staff_id WHERE u.name LIKE 'demo\\_player%'`
    );
    assert.equal(agentPlayers.length, 6);
    assert.deepEqual([...new Set(agentPlayers.map((p) => p.agent))].sort(), ['demo_agent', 'demo_agent2']);
    const [{ transfers }] = await q(
      `SELECT COUNT(*)::int AS transfers FROM staff_transfers t JOIN users u ON u.id = t.to_id
        WHERE t.to_type = 'user' AND u.name LIKE 'demo\\_player%'`
    );
    assert.equal(transfers, 6, 'each agent-tree player was funded from the float');
  });

  // ── Second run: nothing new ───────────────────────────────────────────
  await t.test('a second run writes nothing and rotates nothing', async () => {
    const before = await snapshot();
    const fileBefore = fs.readFileSync(credentialsFile, 'utf8');
    const again = seed();
    assert.equal(again.code, 0, again.stdout);
    assert.match(again.stdout, /No new demo accounts/);
    assert.deepEqual(await snapshot(), before);
    assert.equal(fs.readFileSync(credentialsFile, 'utf8'), fileBefore);
  });

  // ── Reset ─────────────────────────────────────────────────────────────
  await t.test('--reset-demo without --yes deletes nothing', async () => {
    const before = await snapshot();
    const dry = cli('--reset-demo');
    assert.equal(dry.code, 0, dry.stdout);
    assert.match(dry.stdout, /Dry run — nothing was deleted/);
    assert.match(dry.stdout, /21 demo player\(s\), 8 demo staff/);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('--reset-demo --yes removes every demo_ row and its credentials', async () => {
    const ids = (await q(`SELECT id FROM users WHERE name ${DEMO}`)).map((r) => String(r.id));
    const staffIds = (await q(`SELECT id FROM staff WHERE name ${DEMO}`)).map((r) => Number(r.id));

    // A stake reversal and a queued retry for a demo player — and the same for an account that
    // is NOT demo (an id no demo row has), which the reset must leave alone.
    const [{ id: outsider }] = await q(`SELECT COALESCE(MAX(id), 0) + 1000000 AS id FROM users`);
    const tag = `demo-reset-${Date.now()}`;
    for (const [userId, who] of [[Number(ids[0]), 'demo'], [Number(outsider), 'outsider']]) {
      await sequelize.query(
        `INSERT INTO wager_reversals (user_id, source, ref, refund_ref, amount, usd_amount)
           VALUES (:userId, 'test', :ref, NULL, 1, 1)`,
        { replacements: { userId, ref: `${tag}-${who}` } }
      );
      await sequelize.query(
        `INSERT INTO wager_reverse_outbox (origin, user_id, source, ref, status)
           VALUES ('casino', :userId, 'test', :ref, 'failed')`,
        { replacements: { userId, ref: `${tag}-${who}` } }
      );
    }

    const out = cli('--reset-demo', '--yes');
    assert.equal(out.code, 0, out.stdout);

    const zero = async (sql, replacements) => assert.equal((await q(sql, replacements))[0].n, 0, sql);
    await zero(`SELECT COUNT(*)::int AS n FROM users WHERE name ${DEMO} OR email ${DEMO}`);
    await zero(`SELECT COUNT(*)::int AS n FROM staff WHERE name ${DEMO} OR email ${DEMO}`);
    const nids = ids.map(Number);
    await zero('SELECT COUNT(*)::int AS n FROM credits_ledger WHERE user_id IN (:ids)', { ids });
    await zero('SELECT COUNT(*)::int AS n FROM credits WHERE uid IN (:nids)', { nids });
    await zero('SELECT COUNT(*)::int AS n FROM tips WHERE from_user_id IN (:nids) OR to_user_id IN (:nids)', { nids });
    await zero('SELECT COUNT(*)::int AS n FROM player_bonuses WHERE user_id IN (:nids)', { nids });
    await zero('SELECT COUNT(*)::int AS n FROM wager_activity WHERE user_id IN (:nids)', { nids });
    await zero('SELECT COUNT(*)::int AS n FROM vault_pro WHERE userid IN (:nids)', { nids });
    await zero('SELECT COUNT(*)::int AS n FROM user_kyc WHERE user_id IN (:ids)', { ids });
    await zero('SELECT COUNT(*)::int AS n FROM user_notifications WHERE user_id IN (:nids)', { nids });
    await zero('SELECT COUNT(*)::int AS n FROM fiat_deposits WHERE user_id IN (:nids)', { nids });
    await zero('SELECT COUNT(*)::int AS n FROM fiat_withdrawals WHERE uid IN (:nids)', { nids });
    await zero('SELECT COUNT(*)::int AS n FROM userconfig WHERE uid IN (:nids)', { nids });
    await zero("SELECT COUNT(*)::int AS n FROM team WHERE ownername LIKE 'demo\\_%' OR membername LIKE 'demo\\_%'");
    await zero("SELECT COUNT(*)::int AS n FROM rewards WHERE ownername LIKE 'demo\\_%'");
    await zero('SELECT COUNT(*)::int AS n FROM staff_hierarchy WHERE descendant_id IN (:staffIds)', { staffIds });
    await zero("SELECT COUNT(*)::int AS n FROM staff_transfers WHERE (to_type = 'user' AND to_id IN (:nids)) OR (from_type = 'staff' AND from_id IN (:staffIds))", { nids, staffIds });
    const kept = async (table) =>
      (await q(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = :outsider AND ref = :ref`, { outsider, ref: `${tag}-outsider` }))[0].n;
    try {
      await zero('SELECT COUNT(*)::int AS n FROM wager_reversals WHERE user_id IN (:nids)', { nids });
      await zero('SELECT COUNT(*)::int AS n FROM wager_reverse_outbox WHERE user_id IN (:nids)', { nids });
      assert.equal(await kept('wager_reversals'), 1, 'a non-demo reversal survives the reset');
      assert.equal(await kept('wager_reverse_outbox'), 1, 'a non-demo outbox row survives the reset');
    } finally {
      await sequelize.query('DELETE FROM wager_reversals WHERE ref LIKE :tag', { replacements: { tag: `${tag}-%` } });
      await sequelize.query('DELETE FROM wager_reverse_outbox WHERE ref LIKE :tag', { replacements: { tag: `${tag}-%` } });
    }
    assert.equal(credentialRows().length, 0, 'the reset database rows left the credentials file');
  });
});

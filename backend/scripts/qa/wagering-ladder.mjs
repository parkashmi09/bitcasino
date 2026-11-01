#!/usr/bin/env node
/**
 * QA: drive one test player through the WHOLE VIP ladder with fake wager data, through the same
 * code paths a real provider uses, and check every downstream effect at each band crossing.
 *
 *   node scripts/qa/wagering-ladder.mjs                 run (or continue) the ladder for qa_wager_max
 *   node scripts/qa/wagering-ladder.mjs --player NAME   another test player name (referrer: NAME_ref)
 *   node scripts/qa/wagering-ladder.mjs --no-deposit-bonus   skip the first-deposit bonus step
 *   node scripts/qa/wagering-ladder.mjs --json out.json      also write every check as JSON
 *   node scripts/qa/wagering-ladder.mjs --until 6            stop after level 6 (a later run continues)
 *
 * HOW THE FAKE WAGER GETS IN (no external provider is ever called)
 *   seamless mode — when SEAMLESS_SECRET_KEY + SEAMLESS_OPERATOR_CODE are set: every stake is a signed
 *     seamless-wallet callback (`POST /api/seamless/withdraw`, a win `/api/seamless/deposit`) sent to
 *     OUR gateway, exactly what the provider sends: seamless.service → wallet BET_STAKE/BET_PAYOUT →
 *     games.recordActivity → `POST /internal/user/wager/record`.
 *   internal mode — no provider configured (this stack): the same settlement steps a casino callback
 *     performs, called as casino-service: `POST /internal/user/wallet/debit` (BET_STAKE) →
 *     `POST /internal/user/wager/record` (source `qa-ladder`) → `/internal/user/wallet/credit`
 *     (BET_PAYOUT) for a win.
 *   Either way the record runs userwager (USD) → bonus wagering, VIP onWager (rakeback rate +
 *   level/rank-up credits), affiliate commission and rakeback accrual. A few in-house Limbo rounds
 *   (casino socket, `bets` table) are tried first; they are skipped when the plan refuses them.
 *
 * SECRETS
 *   Read inside this process only and never printed: SEAMLESS_* and INTERNAL_KEY_CASINO_SERVICE from
 *   backend/.env, the staff session from scripts/demo-login.mjs, the staff transaction password from
 *   backend/.demo-credentials.local.md, the test players' generated passwords from QA_CREDS_FILE
 *   (default backend/data/qa-credentials.local.json, gitignored; written with mode 600).
 *
 * TEST-ONLY SHORTCUTS (both on the test player's own rows, never on totals)
 *   - The periodic VIP awards are due once per 24h/7d/30d. To see them at every card in one run, the
 *     player's own `bonus_history` rows are moved 31 days back before the internal award-periodic call.
 *   - The first-deposit bonus is switched on for the deposit approval only (site admin API, house
 *     staff) and the previous settings are put back straight after.
 *
 * Re-runnable: the player is reused, the ladder continues from the current wager, and every check
 * that depends on a one-off (deposit, bonus) is skipped once done.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = path.resolve(BACKEND, '..');
const require = createRequire(path.join(BACKEND, 'package.json'));
const dotenv = require('dotenv');
const { Client } = require('pg');
const { io: ioClient } = require('socket.io-client');
const { VIP_LEVELS } = require('./packages/common/src/vipLevels.js');
const { levelUpAmount, rankUpAmount, rakebackRateForCard, periodicAmount } = require('./packages/common/src/vipRewards.js');
const { EVENTS } = require('./packages/socket/src/events.js');

// ── args / config ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const PLAYER = opt('--player', 'qa_wager_max');
const REFERRER = `${PLAYER}_ref`.slice(0, 30);
const JSON_OUT = opt('--json', null);
const WITH_DEPOSIT_BONUS = !flag('--no-deposit-bonus');
const UNTIL = Number(opt('--until', '999'));

const env = dotenv.parse(fs.readFileSync(path.join(BACKEND, '.env')));
const GATEWAY = process.env.GATEWAY_URL || `http://127.0.0.1:${env.GATEWAY_PORT || 4700}`;
const USER_SVC = `http://127.0.0.1:${env.USER_SERVICE_PORT || 4001}`;
const CASINO_SVC = `http://127.0.0.1:${env.CASINO_SERVICE_PORT || 4003}`;
const CREDS_FILE = process.env.QA_CREDS_FILE || path.join(BACKEND, 'data/qa-credentials.local.json');
const STAFF_LOGIN = process.env.QA_STAFF || 'demo_admin@demo.local';

/** Stake pattern: payout multiplier per bet, cycled. RTP 99% — losses and wins, balance stays sane. */
const PATTERN = ['0', '2', '0', '1.96'];
const MAX_STAKE = 250000;

// ── tiny money helpers (8-dp decimal strings via BigInt) ─────────────────────
const SCALE = 10n ** 8n;
const toMinor = (v) => {
  const s = String(v ?? '0').trim();
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const m = BigInt(i || '0') * SCALE + BigInt((f + '00000000').slice(0, 8));
  return neg ? -m : m;
};
const dec = (m) => {
  const neg = m < 0n;
  const a = neg ? -m : m;
  return `${neg ? '-' : ''}${a / SCALE}.${String(a % SCALE).padStart(8, '0')}`;
};
const mul = (a, b) => (toMinor(a) * toMinor(b)) / SCALE;
const add = (...xs) => xs.reduce((s, x) => s + toMinor(x), 0n);
const sub = (a, b) => toMinor(a) - toMinor(b);
const eq = (a, b) => toMinor(a) === toMinor(b);
const fmt = (v, dp = 2) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: 0 });

// ── result collection ────────────────────────────────────────────────────────
const checks = [];
function check(group, name, ok, detail = '') {
  checks.push({ group, name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) console.log(`  FAIL [${group}] ${name} ${detail}`);
  return Boolean(ok);
}
const note = (msg) => console.log(`  · ${msg}`);

// ── secrets kept in process ─────────────────────────────────────────────────
function loadCreds() {
  try { return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8')); } catch { return {}; }
}
function saveCreds(update) {
  const all = { ...loadCreds(), ...update };
  fs.mkdirSync(path.dirname(CREDS_FILE), { recursive: true });
  fs.writeFileSync(CREDS_FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.chmodSync(CREDS_FILE, 0o600);
}
function staffTransactionPassword(login) {
  try {
    const lines = fs.readFileSync(path.join(BACKEND, '.demo-credentials.local.md'), 'utf8').split('\n').filter((l) => l.startsWith('|'));
    const head = lines[0].split('|').map((c) => c.trim().toLowerCase().replace(/\s+/g, ''));
    const col = head.findIndex((h) => h.includes('transaction'));
    const loginCol = head.indexOf('login');
    const emailCol = head.indexOf('email');
    for (const l of lines.slice(2)) {
      const c = l.split('|').map((x) => x.trim().replace(/^`|`$/g, ''));
      if (c[loginCol] === login || c[emailCol] === login) return c[col] && c[col] !== '-' ? c[col] : undefined;
    }
  } catch { /* none */ }
  return undefined;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function http(method, url, { token, body, headers = {}, form } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(url, { method, headers: h, body: payload });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: json, data: json?.data };
}
const api = (method, p, o) => http(method, `${GATEWAY}/api/v1${p}`, o);
const internalUser = (p, body) =>
  http('POST', `${USER_SVC}/internal/user${p}`, {
    body,
    headers: { 'x-internal-key': env.INTERNAL_KEY_CASINO_SERVICE || env.INTERNAL_API_KEY, 'x-internal-service': 'casino-service' },
  });

function utcStamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
async function seamless(action, member, transactions) {
  const request_time = utcStamp();
  const sign = crypto.createHash('md5').update(`${env.SEAMLESS_OPERATOR_CODE}${request_time}${action}${env.SEAMLESS_SECRET_KEY}`).digest('hex');
  const route = action === 'getbalance' ? 'balance' : action;
  const r = await http('POST', `${GATEWAY}/api/seamless/${route}`, {
    body: { operator_code: env.SEAMLESS_OPERATOR_CODE, request_time, sign, member_account: String(member), currency: 'USDT', product_code: 'QA', transactions },
  });
  return r.body;
}

// ── DB ───────────────────────────────────────────────────────────────────────
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0] ?? null;

// ── sessions ─────────────────────────────────────────────────────────────────
function staffToken() {
  const out = execFileSync(process.execPath, [path.join(REPO, 'scripts/demo-login.mjs'), STAFF_LOGIN], { encoding: 'utf8' });
  return JSON.parse(out).accessToken;
}
async function ensurePlayer(name, referredBy) {
  const creds = loadCreds()[name];
  if (creds?.password) {
    const r = await api('POST', '/user/auth/login', { body: { identifier: name, password: creds.password } });
    if (r.status !== 200) throw new Error(`login ${name}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body)}`);
    return { id: String(r.data.user.id), token: r.data.accessToken, created: false };
  }
  const password = `${crypto.randomBytes(15).toString('base64url')}aA1!`;
  const body = { username: name, password, email: `${name}@qa.local` };
  if (referredBy) body.referredBy = referredBy;
  const r = await api('POST', '/user/auth/register', { body });
  if (r.status !== 201 && r.status !== 200) throw new Error(`register ${name}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body)}`);
  saveCreds({ [name]: { email: body.email, password, referredBy: referredBy ?? null, purpose: 'wagering-ladder QA' } });
  return { ...(await ensurePlayer(name)), created: true };
}

// ── state readers ────────────────────────────────────────────────────────────
const wagerOf = async (uid) => (await one('select wager from userwager where uid=$1', [uid]))?.wager ?? '0';
const usdtBalance = async (uid) => (await one('select usdt from credits where uid=$1', [uid]))?.usdt ?? '0';
const vipLedger = (uid) =>
  q(`select idempotency_key k, amount, currency from credits_ledger where user_id=$1 and idempotency_key like 'vip:%' order by id`, [uid]);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// ── the player's bets ────────────────────────────────────────────────────────
let seq = 0;
let runTag = Date.now().toString(36);
const totals = { bets: 0, staked: 0n, paid: 0n, topUps: 0n, wins: 0, losses: 0 };
let staff; // { token, txn }
let P;     // player
let REF;   // referrer

async function topUp(amount) {
  const body = { userId: P.id, currency: 'USDT', amount, operation: 'credit', description: 'QA wagering-ladder bankroll (fake wager test)' };
  if (staff.txn) body.transactionPassword = staff.txn;
  const r = await api('POST', '/admin/user/wallet/adjust', { token: staff.token, body });
  if (r.status >= 300) throw new Error(`wallet adjust: ${r.status} ${JSON.stringify(r.body?.error ?? r.body)}`);
  totals.topUps += toMinor(amount);
}

/**
 * Which path carries a stake.
 *   seamless — the signed provider callback (needs SEAMLESS_SECRET_KEY / SEAMLESS_OPERATOR_CODE).
 *   internal — what every casino settlement does after its own provider bookkeeping, as casino-service:
 *              `POST /internal/user/wallet/debit` (BET_STAKE) → `POST /internal/user/wager/record`
 *              → `POST /internal/user/wallet/credit` (BET_PAYOUT) for a win. Used when no provider is
 *              configured on this stack.
 */
const MODE = env.SEAMLESS_SECRET_KEY && env.SEAMLESS_OPERATOR_CODE ? 'seamless' : 'internal';
const SOURCE = MODE === 'seamless' ? 'seamless' : 'qa-ladder';

async function internalBet(id, stake, win) {
  const debit = await internalUser('/wallet/debit', { userId: Number(P.id), currency: 'USDT', amount: stake, reason: 'BET_STAKE', idempotencyKey: `qa-ladder:stake:${id}`, refType: 'QA_LADDER', refId: id, description: `QA fake stake ${id}` });
  if (debit.status !== 200) throw new Error(`wallet debit ${id}: ${debit.status} ${JSON.stringify(debit.body?.error)}`);
  const rec = await internalUser('/wager/record', { userId: Number(P.id), amount: stake, currency: 'USDT', source: SOURCE, ref: id, rakeback: true });
  if (rec.status !== 200 || !rec.data?.counted) throw new Error(`wager record ${id}: ${rec.status} ${JSON.stringify(rec.data ?? rec.body?.error)}`);
  if (win) {
    const credit = await internalUser('/wallet/credit', { userId: Number(P.id), currency: 'USDT', amount: win, reason: 'BET_PAYOUT', idempotencyKey: `qa-ladder:payout:${id}`, refType: 'QA_LADDER', refId: id, description: `QA fake payout ${id}` });
    if (credit.status !== 200) throw new Error(`wallet credit ${id}: ${credit.status} ${JSON.stringify(credit.body?.error)}`);
  }
}

/** One provider round: stake then, if it wins, the payout. */
async function bet(stake) {
  const balance = await usdtBalance(P.id);
  if (toMinor(balance) < toMinor(stake)) {
    const need = sub(stake, balance) + toMinor(stake) + toMinor(String(1000 + (seq % 97)));
    await topUp(dec(need));
  }
  const id = `qa-${runTag}-${P.id}-${++seq}`;
  const mult = PATTERN[totals.bets % PATTERN.length];
  const win = mult !== '0' ? dec(mul(stake, mult)) : null;
  if (MODE === 'internal') await internalBet(id, stake, win);
  else {
    const w = await seamless('withdraw', P.id, [{ id, amount: stake, round_id: id, game_code: 'qa-ladder' }]);
    if (w.code !== 0) throw new Error(`seamless withdraw ${id}: ${JSON.stringify(w)}`);
    if (win) {
      const d = await seamless('deposit', P.id, [{ id: `${id}-win`, amount: win, round_id: id, game_code: 'qa-ladder' }]);
      if (d.code !== 0) throw new Error(`seamless deposit ${id}: ${JSON.stringify(d)}`);
    }
  }
  totals.bets += 1;
  totals.staked += toMinor(stake);
  if (win) {
    totals.paid += toMinor(win);
    totals.wins += 1;
  } else totals.losses += 1;
  return { id, stake };
}

/** Wager until the lifetime total reaches `target` USD, in a few realistic bets. */
async function wagerTo(target) {
  const done = [];
  const need = sub(target, await wagerOf(P.id));
  if (need <= 0n) return done;
  // A plan, made once: at least two bets (a win and a loss), none above MAX_STAKE, rounded up to cents.
  const needUnits = Number(dec(need));
  const n = Math.max(2, Math.ceil(needUnits / MAX_STAKE));
  const stake = Math.max(0.1, Math.ceil((needUnits / n) * 100) / 100).toFixed(2);
  for (let i = 0; i < n; i += 1) done.push(await bet(stake));
  // Rounding can leave the total a cent short of the floor: one more small bet then.
  if (sub(target, await wagerOf(P.id)) > 0n) done.push(await bet('1.00'));
  return done;
}

// ── in-house rounds (bets table) ─────────────────────────────────────────────
async function inHouseRounds(n, amount) {
  const socket = ioClient(CASINO_SVC, { auth: { token: P.token }, transports: ['websocket'], reconnection: false, timeout: 8000 });
  await new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  const out = [];
  try {
    for (let i = 0; i < n; i += 1) {
      const frame = Buffer.from(JSON.stringify({ amount, coin: 'usdt', payout: i % 2 ? '1.50' : '3.00' }));
      const reply = await new Promise((res) => {
        const t = setTimeout(() => res({ timeout: true }), 8000);
        socket.emit(EVENTS.PLAY_LIMBO, frame, (ack) => {
          clearTimeout(t);
          try { res(JSON.parse(Buffer.from(ack).toString('utf8'))); } catch { res({ raw: String(ack) }); }
        });
      });
      out.push(reply);
    }
  } finally { socket.close(); }
  return out;
}

// ── checks at a crossing ─────────────────────────────────────────────────────
const ledgerSeen = new Map(); // idempotency key → amount
const periodicDone = new Set();

async function checkCrossing(band, prevBand, lastBets, row) {
  const g = `L${band.level}`;
  // VIP API
  const vip = await api('GET', '/user/vip', { token: P.token });
  const v = vip.data ?? {};
  row.apiLevel = v.level;
  row.progress = v.progressPct;
  row.next = v.nextLevel ?? '—';
  check(g, 'GET /user/vip level', v.level === band.level, `got ${v.level}`);
  if (band.level === VIP_LEVELS.length) check(g, 'top: progress 100 / no next', v.progressPct === '100.00' && v.nextLevel == null, JSON.stringify({ p: v.progressPct, n: v.nextLevel }));
  else check(g, 'next level = level+1', v.nextLevel === band.level + 1, `next ${v.nextLevel}`);

  // Level-up / rank-up credits: exactly once, right amount, reward currency
  const ledger = await vipLedger(P.id);
  const keys = new Map();
  for (const r of ledger) keys.set(r.k, (keys.get(r.k) ?? 0) + 1);
  check(g, 'no VIP ledger key twice', [...keys.values()].every((c) => c === 1), JSON.stringify([...keys].filter(([, c]) => c > 1)));
  const luKey = `vip:level_up:${P.id}:${band.level}`;
  const lu = ledger.find((r) => r.k === luKey);
  const luWant = levelUpAmount(band.level);
  row.levelUp = lu ? `${fmt(lu.amount)} ${lu.currency}` : '—';
  check(g, `level-up credited ${luWant}`, lu && eq(lu.amount, luWant) && lu.currency === 'USDT', lu ? `${lu.amount} ${lu.currency}` : 'missing');
  const cardChanged = prevBand && prevBand.card !== band.card && prevBand.level > 0;
  const ruKey = `vip:rank_up:${P.id}:${band.card}`;
  const ru = ledger.find((r) => r.k === ruKey);
  if (cardChanged) {
    row.rankUp = ru ? `${fmt(ru.amount)} ${ru.currency}` : 'MISSING';
    check(g, `rank-up ${band.card} credited ${rankUpAmount(band.card)}`, ru && eq(ru.amount, rankUpAmount(band.card)), ru ? ru.amount : 'missing');
  } else row.rankUp = '—';
  const newRows = ledger.filter((r) => !ledgerSeen.has(r.k));
  for (const r of ledger) ledgerSeen.set(r.k, r.amount);
  const expectedNew = 1 + (cardChanged ? 1 : 0);
  check(g, 'VIP credits this crossing', newRows.length === expectedNew, `${newRows.length} new (${newRows.map((r) => r.k.split(':')[1]).join(',')}) want ${expectedNew}`);

  // Rakeback rate + accrual on the bet that crossed
  const user = await one('select rakeback, rakeamount from users where id=$1', [P.id]);
  const rate = rakebackRateForCard(band.card);
  row.rate = `${(Number(rate) * 100).toFixed(2)}%`;
  check(g, 'users.rakeback = card rate', eq(user.rakeback, rate), `${user.rakeback} want ${rate}`);
  // the bet AFTER the crossing accrues at the new rate: place one small bet and look at its accrual
  const probe = await bet('10.00');
  const acc = await one(`select amount from rakeback_accruals where source=$2 and ref=$1`, [probe.id, SOURCE]);
  check(g, 'next stake accrues at new rate', acc && eq(acc.amount, dec(mul('10', rate))), acc ? `${acc.amount} want ${dec(mul('10', rate))}` : 'no accrual row');
  row.accrual10 = acc?.amount ? fmt(acc.amount, 4) : '—';
  const rb = await api('GET', '/user/rakeback', { token: P.token });
  row.rakebackOpen = fmt(rb.data?.amount ?? 0, 4);
}

async function claimRakeback(g) {
  const before = await api('GET', '/user/rakeback', { token: P.token });
  const amt = before.data?.amount;
  if (!before.data?.claimable) return note(`rakeback not claimable yet (${amt})`);
  const bal0 = await usdtBalance(P.id);
  const r = await api('POST', '/user/rakeback/claim', { token: P.token });
  const bal1 = await usdtBalance(P.id);
  const led = await one(`select amount, currency from credits_ledger where user_id=$1 and reason='rakeback_claim' order by id desc limit 1`, [P.id]);
  check(g, 'rakeback claim credits wallet', r.status === 200 && eq(sub(bal1, bal0) > 0n ? dec(sub(bal1, bal0)) : '0', amt), `claimed ${amt} delta ${dec(sub(bal1, bal0))} ${r.status}`);
  check(g, 'rakeback claim ledger row', led && eq(led.amount, amt) && led.currency === before.data.currency, JSON.stringify(led));
  const again = await api('POST', '/user/rakeback/claim', { token: P.token });
  const after = await one('select rakeamount from users where id=$1', [P.id]);
  check(g, 'rakeback zeroed, second claim pays nothing', eq(after.rakeamount, '0') && (again.status >= 400 || eq(again.data?.amount ?? '0', '0')), `rakeamount ${after.rakeamount} second ${again.status}`);
  return amt;
}

async function periodic(band, g, row) {
  // Age THIS player's award rows so every period is due again, then award through the internal route.
  await q(`update bonus_history set created_at = created_at - interval '31 days' where userid=$1`, [P.id]);
  const r = await internalUser('/vip/award-periodic', { userId: Number(P.id) });
  const rows = r.data?.rows ?? [];
  const want = ['daily', 'weekly', 'monthly'].filter((t) => periodicAmount(band.card, t) !== '0');
  row.periodic = rows.map((x) => `${x.type[0]}${fmt(x.amount)}`).join(' ') || '—';
  check(g, `periodic awards for ${band.card}`, r.status === 200 && want.every((t) => rows.some((x) => x.type === t && eq(x.amount, periodicAmount(band.card, t)))) && rows.length === want.length, `${JSON.stringify(rows)} want ${want}`);
  const again = await internalUser('/vip/award-periodic', { userId: Number(P.id) });
  check(g, 'periodic award not repeated', again.data?.awarded === 0, `second call awarded ${again.data?.awarded}`);
  // Claim the daily one (and weekly/monthly on Gold+): wallet + ledger, once
  const claimTypes = ['daily', ...(band.level >= 12 ? ['weekly', 'monthly'] : [])].filter((t) => want.includes(t));
  const claimed = [];
  for (const t of claimTypes) {
    const bal0 = await usdtBalance(P.id);
    const c = await api('POST', `/user/bonus/claim/${t}`, { token: P.token });
    const bal1 = await usdtBalance(P.id);
    const amount = periodicAmount(band.card, t);
    const ok = c.status === 200 && eq(dec(sub(bal1, bal0)), amount);
    check(g, `claim ${t} pays ${amount} USDT`, ok, `status ${c.status} ${c.body?.error?.code ?? ''} delta ${dec(sub(bal1, bal0))}`);
    // A second claim may legitimately pay an OLDER unclaimed award of the same type (one the
    // ladder walk left unclaimed at an earlier card); it must never pay the same award again.
    const c2 = await api('POST', `/user/bonus/claim/${t}`, { token: P.token });
    const bal2 = await usdtBalance(P.id);
    const lastKey = await one(`select idempotency_key k, amount from credits_ledger where user_id=$1 and idempotency_key like 'bonus:%' order by id desc limit 1`, [P.id]);
    const dupKeys = await one(`select count(*)::int n from (select idempotency_key from credits_ledger where user_id=$1 and idempotency_key like 'bonus:%' group by 1 having count(*)>1) x`, [P.id]);
    const award = lastKey ? await one(`select bonus_type, bonus_amount from bonus_history where id=$1`, [lastKey.k.split(':')[1]]) : null;
    const secondOk = c2.status >= 400
      ? eq(bal2, bal1)
      : award?.bonus_type === t && eq(dec(sub(bal2, bal1)), award.bonus_amount);
    check(g, `claim ${t} again: never the same award twice`, dupKeys.n === 0 && secondOk, `second ${c2.status} ${c2.body?.error?.code ?? ''} paid ${dec(sub(bal2, bal1))} (${lastKey?.k})`);
    if (c2.status < 300) note(`second ${t} claim paid an older unclaimed ${t} award (${lastKey?.k}, ${fmt(award?.bonus_amount)})`);
    if (ok) claimed.push(`${t[0]}${fmt(amount)}`);
  }
  row.claimed = claimed.join(' ') || '—';
}

async function reconcile(g, row) {
  const r = await api('GET', `/admin/user/wallet/${P.id}/reconcile`, { token: staff.token });
  row.reconciled = r.data?.balanced ? 'yes' : 'NO';
  check(g, 'wallet reconcile balanced', r.status === 200 && r.data?.balanced === true, JSON.stringify(r.data?.currencies?.filter?.((c) => !c.balanced) ?? r.body?.error));
}

async function bonusState(g, row) {
  const b = await api('GET', '/user/bonus-balance', { token: P.token });
  const active = b.data?.active ?? [];
  row.bonusLock = active.length ? active.map((a) => `${fmt(a.wagered ?? a.wageredAmount ?? 0)}/${fmt(a.wagerRequired ?? a.requirement ?? a.target ?? 0)}`).join(',') : (b.data?.history?.length ? 'released' : '—');
  const t = await api('GET', '/user/wager/tasks', { token: P.token });
  const task = t.data?.tasks?.[0];
  row.rollover = task ? `${task.status ?? (task.completed ? 'done' : 'open')}` : '—';
  return { active, history: b.data?.history ?? [], tasks: t.data };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  await db.connect();
  staff = { token: staffToken(), txn: staffTransactionPassword(STAFF_LOGIN) };

  // 1. players
  REF = await ensurePlayer(REFERRER, null);
  const refCode = (await one('select referalcode from users where id=$1', [REF.id]))?.referalcode;
  P = await ensurePlayer(PLAYER, refCode);
  console.log(`player ${PLAYER} id=${P.id} (${P.created ? 'registered now' : 'existing'}), referrer ${REFERRER} id=${REF.id}`);
  const agentRow = await one('select parent_staff_id from users where id=$1', [P.id]).catch(() => null);
  check('setup', 'player is direct (not agent tree)', !agentRow?.parent_staff_id, JSON.stringify(agentRow));

  await assertPlatformLadder();
  const bands = VIP_LEVELS.filter((b) => b.level <= UNTIL);

  // 2. KYC (needed for the withdrawal-lock check)
  const kycNow = await api('GET', '/user/kyc/status', { token: P.token });
  if (!JSON.stringify(kycNow.data ?? {}).includes('Verified')) {
    // A 1×1 PNG as the ID front: the review is what this test needs, not the document.
    const form = new FormData();
    for (const [k, v] of Object.entries({ firstName: 'QA', lastName: 'Wager', dateOfBirth: '1990-01-01', address: '1 Test St', city: 'Testville', country: 'IN', documentType: 'id_card' })) form.set(k, v);
    form.set('idFront', new Blob([PNG], { type: 'image/png' }), 'id.png');
    const sub = await api('POST', '/user/kyc/submit', { token: P.token, form });
    check('setup', 'player submits KYC', sub.status < 300, `${sub.status} ${sub.body?.error?.code ?? ''}`);
  }
  const kyc = await api('PUT', '/admin/user/kyc/review', { token: staff.token, body: { userId: Number(P.id), status: 'Verified' } });
  check('setup', 'KYC verified via admin API', kyc.status === 200, `${kyc.status} ${kyc.body?.error?.code ?? ''}`);

  // 3. first deposit + bonus with wagering (one-off)
  let depositState = null;
  const hasDeposit = await one(`select deposit_id from fiat_deposits where user_id=$1 and status='approved' limit 1`, [P.id]);
  if (!hasDeposit) depositState = await depositWithBonus();
  else note('deposit already done on an earlier run');

  // 4. a few in-house Limbo rounds (bets table → wager-stats / P&L / profile stats)
  const ihBefore = await one(`select count(*)::int n from bets where uid=$1`, [P.id]);
  if (ihBefore.n === 0 && !flag('--no-inhouse')) {
    const w0 = await wagerOf(P.id);
    if (toMinor(await usdtBalance(P.id)) < toMinor('20')) await topUp('50.00');
    const rounds = await inHouseRounds(6, '2');
    const settled = rounds.filter((r) => r.command === 'busted');
    const w1 = await wagerOf(P.id);
    if (rounds[0]?.code === 'NOT_ENTITLED') note('in-house games: NOT_ENTITLED in the owner plan — skipped (plan left as is)');
    else check('in-house', 'Limbo rounds settle (socket)', settled.length === 6, JSON.stringify(rounds.find((r) => r.command !== 'busted') ?? ''));
    if (settled.length) check('in-house', 'in-house stakes counted in USD wager', eq(dec(sub(w1, w0)), dec(toMinor('2') * BigInt(settled.length))), `${dec(sub(w1, w0))}`);
    note(`in-house: ${settled.filter((r) => r.win).length} wins / ${settled.length} rounds`);
  }

  // 5. the ladder
  const table = [];
  let prev = null;
  const startWager = await wagerOf(P.id);
  for (const r of await vipLedger(P.id)) ledgerSeen.set(r.k, r.amount);
  for (const band of bands) {
    if (Number(startWager) >= band.minXp) { prev = band; continue; }
    const g = `L${band.level}`;
    const row = { level: band.level, name: band.name, card: band.card, minXp: band.minXp };
    const before = totals.bets;
    const crossing = await wagerTo(String(band.minXp));
    row.bets = totals.bets - before;
    row.wager = await wagerOf(P.id);
    await checkCrossing(band, prev, crossing, row);
    const cardChanged = !prev || prev.card !== band.card;
    if (cardChanged && periodicAmount(band.card, 'daily') !== '0' && !periodicDone.has(band.card)) {
      await periodic(band, g, row);
      periodicDone.add(band.card);
      row.rakebackClaimed = (await claimRakeback(g)) ?? '—';
    }
    const bs = await bonusState(g, row);
    if (depositState && !depositState.unlocked && depositState.bonusId && bs.active.length === 0) {
      depositState.unlocked = await withdrawUnlocked(g, depositState);
    }
    await reconcile(g, row);
    row.balance = fmt(await usdtBalance(P.id));
    table.push(row);
    console.log(`L${String(band.level).padStart(2)} ${band.name.padEnd(11)} wager ${fmt(row.wager).padStart(14)}  api ${row.apiLevel}  lvl-up ${row.levelUp}  rank-up ${row.rankUp}  rate ${row.rate}  periodic ${row.periodic ?? ''}`);
    prev = band;
  }

  // 6. at the top
  if (UNTIL >= VIP_LEVELS.length) await atTheTop();

  // 7. downstream reads: affiliate, profile, admin reports
  await downstream();

  printTable(table);
  const failed = checks.filter((c) => !c.ok);
  console.log(`\nchecks: ${checks.length - failed.length} pass, ${failed.length} fail`);
  for (const f of failed) console.log(`  FAIL [${f.group}] ${f.name} — ${f.detail}`);
  console.log(`bets ${totals.bets} (wins ${totals.wins}, losses ${totals.losses}), staked ${fmt(dec(totals.staked))}, paid ${fmt(dec(totals.paid))}, bankroll top-ups ${fmt(dec(totals.topUps))} USDT`);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ player: { name: PLAYER, id: P.id }, referrer: { name: REFERRER, id: REF.id }, table, checks, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, typeof v === 'bigint' ? dec(v) : v])) }, null, 2));
  await db.end();
  process.exitCode = failed.length ? 1 : 0;
}

/** The site's `vip` variant picks the ladder (vipLadders.js); this walk is written for the platform one. */
async function assertPlatformLadder() {
  const row = await one(`select variant from site_features where feature='vip'`);
  const { vipLadderFor } = require('./packages/common/src/vipLadders.js');
  const ladder = vipLadderFor(row?.variant);
  note(`vip variant ${row?.variant} → ladder ${ladder.key} (${ladder.levels.length} levels, top ${ladder.levels.at(-1).minXp})`);
  if (ladder.key !== 'platform') throw new Error(`site runs ladder ${ladder.key}; this script walks the platform ladder`);
}

async function depositWithBonus() {
  const g = 'deposit-bonus';
  const cfgPath = '/admin/site-config/welcome-bonuses';
  const saved = (await api('GET', cfgPath, { token: staff.token })).data;
  let switched = false;
  if (WITH_DEPOSIT_BONUS && saved?.firstDepositBonus && (!saved.firstDepositBonus.enabled || !saved.firstDepositBonus.wagerMultiplier)) {
    const fdb = saved.firstDepositBonus;
    const r = await api('PUT', cfgPath, { token: staff.token, body: { firstDepositBonus: { enabled: true, tiers: fdb.tiers, wagerMultiplier: 10, expiryDays: fdb.expiryDays ?? 30 }, transactionPassword: staff.txn } });
    switched = r.status === 200;
    check(g, 'first-deposit bonus switched on for the test (10x)', switched, `${r.status} ${r.body?.error?.code ?? ''}`);
  }
  const state = { bonusId: null, unlocked: false };
  try {
    let depId = (await one(`select deposit_id from fiat_deposits where user_id=$1 and status='pending' order by deposit_id limit 1`, [P.id]))?.deposit_id;
    if (!depId) {
    const form = new FormData();
    form.set('amount', '200');
    form.set('currency', 'USDT');
    form.set('transactionId', `QA-WL-${Date.now()}`);
    form.set('bankName', 'QA Bank');
    form.set('screenshot', new Blob([PNG], { type: 'image/png' }), 'proof.png');
    const d = await api('POST', '/user/deposits/fiat', { token: P.token, form });
    check(g, 'player fiat deposit request', d.status === 201 || d.status === 200, `${d.status} ${d.body?.error?.code ?? ''} ${d.body?.error?.message ?? ''}`);
    depId = d.data?.deposit_id ?? d.data?.depositId ?? d.data?.id;
    }
    const a = await api('PUT', `/admin/user/deposits/fiat/${depId}/approve`, { token: staff.token, body: { comment: 'QA wagering ladder' } });
    check(g, 'staff approves deposit', a.status === 200, `${a.status} ${a.body?.error?.code ?? ''}`);
    const fdb = a.data?.firstDepositBonus;
    note(`first-deposit bonus: ${JSON.stringify(fdb)}`);
    const bb = await api('GET', '/user/bonus-balance', { token: P.token });
    const active = bb.data?.active ?? [];
    state.bonusId = active[0]?.id ?? null;
    if (WITH_DEPOSIT_BONUS) {
      check(g, 'bonus is locked with a wagering requirement', active.length === 1, JSON.stringify(active[0] ?? bb.body?.error));
      const w = await api('POST', '/user/withdrawals/fiat', { token: P.token, body: { amount: '5', currency: 'USDT', accountHolderName: 'QA Wager', bankName: 'QA Bank', accountNumber: '000111', ifscCode: 'QAIF0000001' } });
      check(g, 'withdraw refused while bonus locked (409 BONUS_FORFEIT_REQUIRED)', w.status === 409 && w.body?.error?.code === 'BONUS_FORFEIT_REQUIRED', `${w.status} ${w.body?.error?.code}`);
      if (w.status < 300) await rejectWithdrawal(w.data?.withdrawalId ?? w.data?.id, g);
    }
    const t = await api('GET', '/user/wager/tasks', { token: P.token });
    check(g, 'rollover task created from the deposit', (t.data?.tasks ?? []).length === 1, JSON.stringify(t.data));
    state.task = t.data;
  } finally {
    if (switched) {
      const fdb = saved.firstDepositBonus;
      const r = await api('PUT', cfgPath, { token: staff.token, body: { firstDepositBonus: { enabled: fdb.enabled, tiers: fdb.tiers, wagerMultiplier: fdb.wagerMultiplier ?? null, expiryDays: fdb.expiryDays ?? 30 }, transactionPassword: staff.txn } });
      check(g, 'first-deposit bonus settings restored', r.status === 200, `${r.status} ${r.body?.error?.code ?? ''}`);
    }
  }
  return state;
}

async function withdrawUnlocked(g, state) {
  const bb = await api('GET', '/user/bonus-balance', { token: P.token });
  const released = (bb.data?.history ?? []).find((h) => String(h.id) === String(state.bonusId));
  check(g, 'bonus released to cash after wagering', released && /complet|released/i.test(String(released.status)), JSON.stringify(released ?? bb.data));
  const w = await api('POST', '/user/withdrawals/fiat', { token: P.token, body: { amount: '5', currency: 'USDT', accountHolderName: 'QA Wager', bankName: 'QA Bank', accountNumber: '000111', ifscCode: 'QAIF0000001' } });
  check(g, 'withdraw allowed after the bonus completes', w.status === 201 || w.status === 200, `${w.status} ${w.body?.error?.code ?? ''}`);
  if (w.status < 300) await rejectWithdrawal(w.data?.withdrawalId ?? w.data?.id, g);
  return true;
}

async function rejectWithdrawal(wid, g) {
  const bal0 = await usdtBalance(P.id);
  const r = await api('POST', '/admin/user/withdrawals/fiat/status', { token: staff.token, body: { withdrawalId: Number(wid), status: 'Rejected', comment: 'QA test withdrawal, refunded' } });
  const bal1 = await usdtBalance(P.id);
  check(g, 'test withdrawal rejected + refunded', r.status === 200 && eq(dec(sub(bal1, bal0)), '5'), `${r.status} ${r.body?.error?.code ?? ''} refund ${dec(sub(bal1, bal0))}`);
}

async function atTheTop() {
  const g = 'top';
  const ledger0 = await vipLedger(P.id);
  const w0 = await wagerOf(P.id);
  for (let i = 0; i < 4; i += 1) await bet('125000.00');
  const w1 = await wagerOf(P.id);
  check(g, 'further wager still counted', eq(dec(sub(w1, w0)), '500000'), dec(sub(w1, w0)));
  const v = (await api('GET', '/user/vip', { token: P.token })).data ?? {};
  check(g, 'level stays top, progress maxed', v.level === VIP_LEVELS.length && v.progressPct === '100.00' && v.nextLevel == null && v.wagerToNextLevel == null, JSON.stringify(v));
  const ledger1 = await vipLedger(P.id);
  check(g, 'no VIP credit for wager above the top', ledger1.length === ledger0.length, `${ledger0.length} → ${ledger1.length}`);
  const want = VIP_LEVELS.reduce((s, b) => s + toMinor(levelUpAmount(b.level)), 0n)
    + [...new Set(VIP_LEVELS.map((b) => b.card))].filter((c) => c !== 'wood').reduce((s, c) => s + toMinor(rankUpAmount(c)), 0n);
  const got = ledger1.reduce((s, r) => s + toMinor(r.amount), 0n);
  check(g, 'sum of all VIP credits = table total', got === want, `${dec(got)} want ${dec(want)} (${ledger1.length} rows)`);
  // A provider retry of the same stake does not count twice
  const last = await one(`select ref from wager_activity where user_id=$1 and source=$2 order by id desc limit 1`, [P.id, SOURCE]);
  const amount = (await one(`select amount from wager_activity where source=$2 and ref=$1`, [last.ref, SOURCE])).amount;
  const bal0 = await usdtBalance(P.id);
  const retry = MODE === 'seamless'
    ? await seamless('withdraw', P.id, [{ id: last.ref, amount, round_id: last.ref }])
    : (await internalUser('/wallet/debit', { userId: Number(P.id), currency: 'USDT', amount: dec(toMinor(amount)), reason: 'BET_STAKE', idempotencyKey: `qa-ladder:stake:${last.ref}`, refType: 'QA_LADDER', refId: last.ref })).data;
  check(g, 'retried stake: no second debit, no second count', eq(await wagerOf(P.id), w1) && eq(await usdtBalance(P.id), bal0), JSON.stringify(retry));
  // Direct replay on the internal record route too
  const rr = await internalUser('/wager/record', { userId: Number(P.id), amount: dec(toMinor(amount)), currency: 'USDT', source: SOURCE, ref: last.ref });
  check(g, 'internal wager/record replay is a duplicate', rr.data?.duplicate === true && eq(await wagerOf(P.id), w1), JSON.stringify(rr.data));
  // Periodic at the top: nothing twice
  const pa = await internalUser('/vip/award-periodic', { userId: Number(P.id) });
  check(g, 'periodic not re-awarded inside the period', pa.data?.awarded === 0, JSON.stringify(pa.data));
  const user = await one('select rakeback from users where id=$1', [P.id]);
  check(g, 'rakeback rate stays diamond', eq(user.rakeback, rakebackRateForCard('diamond')), user.rakeback);
  await reconcile(g, {});
}

async function downstream() {
  const g = 'downstream';
  const wager = await wagerOf(P.id);
  const activity = await one(`select coalesce(sum(usd_amount),0) s, count(*)::int n, count(*) filter (where source=$2)::int ns from wager_activity where user_id=$1 and reversed_at is null`, [P.id, SOURCE]);
  check(g, 'userwager = sum(wager_activity.usd_amount)', eq(wager, activity.s), `${wager} vs ${activity.s}`);
  const dupAcc = await one(`select count(*)::int n from (select source, ref from rakeback_accruals where user_id=$1 group by 1,2 having count(*)>1) x`, [P.id]);
  check(g, 'one rakeback accrual per stake', dupAcc.n === 0, `${dupAcc.n} duplicated`);
  // Stakes that left the player Unranked (running total below the first band) earn nothing; every other one accrues once.
  const acc = await one(`with w as (
      select source, ref, sum(usd_amount) over (order by id) as running from wager_activity where user_id=$1 and reversed_at is null)
    select count(*) filter (where w.running < $2)::int unranked,
           count(*) filter (where w.running < $2 and r.id is not null)::int unranked_accrued,
           count(*) filter (where w.running >= $2)::int ranked,
           count(*) filter (where w.running >= $2 and r.id is not null)::int ranked_accrued
      from w left join rakeback_accruals r on r.source = w.source and r.ref = w.ref`, [P.id, VIP_LEVELS[0].minXp]);
  check(g, 'every ranked stake accrued rakeback', acc.ranked === acc.ranked_accrued, JSON.stringify(acc));
  check(g, 'Unranked stakes accrued nothing (rate 0)', acc.unranked_accrued === 0, JSON.stringify(acc));

  // Periodic awards: every claimed award paid exactly once, at its own amount
  const per = await one(`select
      (select count(*)::int from bonus_history where userid=$2 and is_claimed) claimed,
      (select count(*)::int from credits_ledger where user_id=$1 and idempotency_key like 'bonus:%') paid,
      (select coalesce(sum(bonus_amount),0) from bonus_history where userid=$2 and is_claimed) claimed_sum,
      (select coalesce(sum(amount::numeric),0) from credits_ledger where user_id=$1 and idempotency_key like 'bonus:%') paid_sum`, [P.id, Number(P.id)]);
  check(g, 'periodic: one ledger credit per claimed award, amounts equal', per.claimed === per.paid && eq(per.claimed_sum, per.paid_sum), JSON.stringify(per));

  // Affiliate commission to the referrer
  const com = await one(`select count(*)::int n, coalesce(sum(amount::numeric),0) s, count(distinct (source, ref))::int d from rewards where owner_id=$1 and coalesce(voided,false)=false and type ilike '%commission%'`, [REF.id]).catch(async () => one(`select count(*)::int n, coalesce(sum(amount::numeric),0) s, count(distinct (source, ref))::int d from rewards where owner_id=$1`, [REF.id]));
  check(g, 'affiliate commission rows for the referrer', com.n > 0, JSON.stringify(com));
  check(g, 'one commission row per stake', com.n === com.d, JSON.stringify(com));
  const aff = await api('GET', '/user/affiliate/rewards', { token: REF.token });
  note(`referrer commission: ${com.n} rows, ${fmt(com.s, 4)} USDT (rate ≈ ${(Number(com.s) / Number(wager) * 100).toFixed(4)}% of USD wager); /user/affiliate/rewards ${aff.status}`);

  // Player-facing totals
  const turnover = await api('GET', '/user/profile/turnover?currency=USD', { token: P.token });
  note(`/user/profile/turnover ${turnover.status}: ${JSON.stringify(turnover.data).slice(0, 300)}`);
  const stats = await api('GET', '/user/profile/stats', { token: P.token });
  note(`/user/profile/stats ${stats.status}: ${JSON.stringify(stats.data).slice(0, 300)}`);
  const tWager = JSON.stringify(turnover.data ?? {}).match(/"(?:wager|wagered|totalWager|turnover)"\s*:\s*"?([\d.]+)/)?.[1];
  check(g, 'profile turnover = lifetime USD wager', tWager && Math.abs(Number(tWager) - Number(wager)) < 0.01, `turnover ${tWager} vs ${wager}`);
  const sWager = JSON.stringify(stats.data ?? {}).match(/"(?:totalWagered|wagered|wager|totalWager)"\s*:\s*"?([\d.]+)/)?.[1];
  if (MODE === 'seamless') check(g, 'profile stats wagered = lifetime USD wager', sWager && Math.abs(Number(sWager) - Number(wager)) < 1, `stats ${sWager} vs ${wager}`);
  else note(`profile stats wagered ${sWager} — reads provider bet tables only (bets/gis/js-games/game_transactions), so fake internal stakes are not in it`);

  // Admin side
  const rep = await api('GET', `/admin/reports/players/${P.id}`, { token: staff.token });
  const repWager = JSON.stringify(rep.data ?? {}).match(/"(?:wager|totalWager|wagered|lifetimeWager)"\s*:\s*"?([\d.]+)/)?.[1];
  note(`admin players/:id ${rep.status}: ${JSON.stringify(rep.data).slice(0, 400)}`);
  check(g, 'admin player report wager = userwager', repWager && Math.abs(Number(repWager) - Number(wager)) < 0.01, `${repWager} vs ${wager}`);
  const pst = await api('GET', `/admin/reports/players/${P.id}/stats`, { token: staff.token });
  note(`admin players/:id/stats ${pst.status}: ${JSON.stringify(pst.data).slice(0, 500)}`);
  const ledgerStake = await one(`select coalesce(-sum(amount::numeric) filter (where reason='BET_STAKE'),0) staked, coalesce(sum(amount::numeric) filter (where reason='BET_PAYOUT'),0) paid from credits_ledger where user_id=$1`, [P.id]);
  note(`ledger: staked ${fmt(ledgerStake.staked)} paid ${fmt(ledgerStake.paid)} → player P&L ${fmt(Number(ledgerStake.paid) - Number(ledgerStake.staked))}`);
  const risk = await api('GET', `/admin/reports/user-risk/${P.id}`, { token: staff.token });
  note(`admin user-risk ${risk.status}: ${JSON.stringify(risk.data).slice(0, 400)}`);
  const ws = await api('GET', `/admin/reports/wager-stats?area=casino`, { token: staff.token });
  note(`admin wager-stats (site, casino) ${ws.status}: ${JSON.stringify(ws.data ?? ws.body?.error).slice(0, 400)}`);
  const pnl = await api('GET', `/admin/reports/pnl-stats/summary`, { token: staff.token });
  note(`admin pnl-stats ${pnl.status}: ${JSON.stringify(pnl.data ?? pnl.body?.error).slice(0, 400)}`);

  // Races
  const race = await api('GET', '/user/race', { token: P.token });
  const open = await one(`select count(*)::int n from races where status='open'`).catch(() => ({ n: 0 }));
  note(`races: ${open.n} open race(s); /user/race ${race.status}`);
  check(g, 'race: none running (owner plan untouched)', true, `${open.n} open`);

  // Rewards statement
  const rw = await api('GET', '/user/wallet/ledger?reason=REWARDS&limit=100', { token: P.token });
  note(`rewards statement rows (first page): ${(rw.data?.rows ?? rw.data?.items ?? rw.data ?? []).length ?? '?'}`);
}

function printTable(rows) {
  const cols = [
    ['level', 'Lv'], ['name', 'Name'], ['minXp', 'Band from (USD)'], ['bets', 'Bets'], ['wager', 'Wager after'], ['apiLevel', 'API'],
    ['levelUp', 'Level-up'], ['rankUp', 'Rank-up'], ['rate', 'RB rate'], ['accrual10', 'RB on $10'], ['periodic', 'Periodic'],
    ['claimed', 'Claimed'], ['rakebackClaimed', 'RB claimed'], ['bonusLock', 'Bonus lock'], ['rollover', 'Rollover'], ['reconciled', 'Recon'],
  ];
  const cell = (r, k) => (k === 'wager' || k === 'minXp' ? fmt(r[k]) : r[k] ?? '');
  const w = cols.map(([k, h]) => Math.max(h.length, ...rows.map((r) => String(cell(r, k)).length)));
  const line = (vals) => `| ${vals.map((v, i) => String(v).padEnd(w[i])).join(' | ')} |`;
  console.log(`\n${line(cols.map(([, h]) => h))}`);
  console.log(`|${w.map((n) => '-'.repeat(n + 2)).join('|')}|`);
  for (const r of rows) console.log(line(cols.map(([k]) => cell(r, k))));
}

main().catch(async (error) => {
  console.error(`ERROR ${error.stack ?? error}`);
  try { await db.end(); } catch { /* closed */ }
  process.exit(2);
});

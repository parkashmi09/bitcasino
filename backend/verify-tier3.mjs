/* Throwaway verification for the Tier 3 routes — gaps 4, 7, 13, 14, 16, 17 and 18.
 *
 *   cd "backend copy" && node verify-tier3.mjs
 *
 * No rate-limit caveat: nothing here registers an account. It creates a
 * temporary approved deposit and two whitelist addresses, and removes both.
 *
 * Gaps 12/10/20/23/25 are `verify-new-routes.mjs`; gaps 2/19 are
 * `verify-tier2.js`, which drives the game engine instead. Nothing in src/
 * imports any of the three.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Demo passwords are random per account and live only in the gitignored
// .demo-credentials.local.md (written by `node scripts/seed-data.js --demo`).
// Read them through the seed's helper — and never print them.
const { lookupPassword } = createRequire(import.meta.url)('./scripts/lib/demo-credentials.js');
const demoPassword = (login) => {
  try {
    return lookupPassword(login);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
};
// Fail before touching anything if the file or an account this run signs in as is missing.
for (const login of ['demo_player01', 'demo_player03']) demoPassword(login);

const { default: pg } = await import(pathToFileURL('./node_modules/pg/lib/index.js').href);

const B = 'http://127.0.0.1:4000/api/v1';
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n.padEnd(52)} ${String(d).slice(0, 62)}`);
};
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`);

const login = async (u) => {
  const r = await fetch(B + '/user/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: u, password: demoPassword(u) }),
  });
  return (await r.json())?.data;
};
const req = async (m, p, b, h) => {
  const x = await fetch(B + p, {
    method: m,
    headers: { 'content-type': 'application/json', ...(h ?? {}) },
    ...(b ? { body: JSON.stringify(b) } : {}),
  });
  let j = null;
  try { j = await x.json(); } catch { /* empty body */ }
  return [x.status, j];
};
const get = (p, h) => req('GET', p, null, h);

const c = new pg.Client({ host: '127.0.0.1', port: 5433, user: 'postgres', password: 'root', database: 'bc_games' });
await c.connect();

const d3 = await login('demo_player03');
const H = { authorization: 'Bearer ' + d3.accessToken };
const { rows: [me] } = await c.query(`select id from users where name='demo_player03'`);

let seededDeposit = null;
let s;
let j;

try {
  // ══════════════════════════════════════════════════════════════════════
  section('gap 4 — the VIP ladder');
  [s, j] = await get('/user/vip/levels');
  check('GET /user/vip/levels is PUBLIC (no token)', s === 200, `status=${s} ${j?.data?.length} bands`);
  check('  75 bands', j?.data?.length === 75, `${j?.data?.length}`);
  check('  the top band is OPEN-ENDED (maxXp null)', j?.data?.[74]?.maxXp === null, JSON.stringify(j?.data?.[74]));
  check('  every band carries a card tier', j?.data?.every((b) => !!b.card),
    [...new Set(j?.data?.map((b) => b.card))].join(','));

  [s] = await get('/user/vip');
  check('GET /user/vip needs a token', s === 401, `status=${s}`);
  [s, j] = await get('/user/vip', H);
  const vip = j?.data;
  check('  with one -> 200', s === 200, JSON.stringify(vip).slice(0, 70));
  check('  it carries level, next and progress',
    vip && 'level' in vip && 'nextLevel' in vip && 'progressPct' in vip, `level=${vip?.level}`);
  const [, bonus] = await get('/user/bonus', H);
  check('  the SAME level the bonus payload computes', vip?.level === bonus?.data?.vip?.level,
    `vip=${vip?.level} bonus=${bonus?.data?.vip?.level}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 13 — public top wins');
  [s, j] = await get('/casino/bet-history/top-wins');
  check('GET /casino/bet-history/top-wins is PUBLIC', s === 200, `status=${s} ${j?.data?.length} rows`);
  check('  it names NOBODY', (j?.data ?? []).every((r) => !('name' in r) && !('userId' in r) && !('uid' in r)),
    Object.keys(j?.data?.[0] ?? {}).join(','));
  check('  every row is a WIN', (j?.data ?? []).every((r) => Number(r.profit) > 0), `${j?.data?.length} rows`);
  [s] = await get('/casino/bet-history/top-wins?limit=0');
  check('  limit=0 refused', s === 422, `status=${s}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 7 — the contest leaderboard');
  [s, j] = await get('/casino/bet-history/leaderboard');
  check('GET .../leaderboard is PUBLIC', s === 200, `status=${s}`);
  check('  it declares its period and scope', !!j?.data?.period && 'scope' in (j?.data ?? {}),
    `period=${j?.data?.period} scope=${j?.data?.scope}`);
  check('  rows are RANKED', (j?.data?.rows ?? []).every((r, i) => r.rank === i + 1), `${j?.data?.rows?.length} rows`);
  check('  players are MASKED, not named', (j?.data?.rows ?? []).every((r) => /^Player \d{4}$/.test(r.player)),
    j?.data?.rows?.[0]?.player);
  [s] = await get('/casino/bet-history/leaderboard?period=nope');
  check('  a bad period -> 422', s === 422, `status=${s}`);
  [s, j] = await get('/casino/bet-history/leaderboard/me', H);
  check('GET leaderboard/me -> 200', s === 200, JSON.stringify(j?.data).slice(0, 62));
  check('  rank is present (number or null, never undefined)', j?.data && 'rank' in j.data, `rank=${j?.data?.rank}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 18 — one bet');
  const [, hist] = await get('/casino/bet-history?limit=1', H);
  const betId = hist?.data?.[0]?.id ?? hist?.data?.[0]?.betId;
  [s, j] = await get(`/casino/bet-history/${betId}`, H);
  check('GET /casino/bet-history/:betId -> 200', s === 200, JSON.stringify(j?.data).slice(0, 62));
  check('  it carries the provably-fair pair', j?.data && 'hash' in j.data && 'result' in j.data, '');
  [s, j] = await get('/casino/bet-history/999999999', H);
  check('  a foreign/absent bet -> 404', s === 404, `status=${s} ${j?.error?.code}`);
  [s] = await get('/casino/bet-history/stats', H);
  check('  /stats still works (not swallowed by :betId)', s === 200, `status=${s}`);
  [s] = await get('/casino/bet-history/timed-rounds?interval=1m', H);
  check('  /timed-rounds still works', s === 200, `status=${s}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 17 — another player’s profile');
  [s, j] = await get(`/user/profile/${me.id}/public`);
  const pp = j?.data;
  check('GET /user/profile/:id/public is PUBLIC', s === 200, `status=${s}`);
  check('  it names the player and their level', !!pp?.username && 'level' in (pp ?? {}),
    `${pp?.username} level=${pp?.level} card=${pp?.card}`);
  check('  a REAL join date', !!pp?.joinedAt && new Date(pp.joinedAt).getFullYear() > 2000, pp?.joinedAt);
  check('  and the counts from casino-service', typeof pp?.bets === 'number', `bets=${pp?.bets} wins=${pp?.wins}`);
  check('  NO email / phone / country / balance',
    !['email', 'phone', 'country', 'balance', 'wallet', 'referralCode', 'status'].some((k) => k in (pp ?? {})),
    Object.keys(pp ?? {}).join(','));
  [s, j] = await get('/user/profile/999999999999/public');
  check('  an unknown id -> 404', s === 404, `status=${s} ${j?.error?.code}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 16 — the withdrawal whitelist');
  [s] = await get('/user/withdrawals/whitelist');
  check('the list needs a token', s === 401, `status=${s}`);
  [s, j] = await get('/user/withdrawals/whitelist', H);
  check('GET whitelist -> 200', s === 200, JSON.stringify(j?.data));
  check('  it reports enforcement alongside the list', j?.data && 'whitelistOnly' in j.data, `only=${j?.data?.whitelistOnly}`);

  [s, j] = await req('PUT', '/user/withdrawals/whitelist/enforcement', { enabled: true }, H);
  check('turning it ON with an EMPTY list is refused', s === 422, `status=${s} ${j?.error?.code}`);

  [s, j] = await req('POST', '/user/withdrawals/whitelist',
    { label: 'My Tron wallet', currency: 'usdt', network: 'TRC20', address: 'TXk9probe1234567890abcdef' }, H);
  check('POST an address -> 201', s === 201, JSON.stringify(j?.data).slice(0, 62));
  const id = j?.data?.id;
  check('  currency is upper-cased', j?.data?.currency === 'USDT', j?.data?.currency);
  check('  the address is stored AS TYPED (case preserved)',
    j?.data?.address === 'TXk9probe1234567890abcdef', j?.data?.address);

  [s, j] = await req('POST', '/user/withdrawals/whitelist',
    { label: 'dup', currency: 'USDT', address: 'TXk9probe1234567890abcdef' }, H);
  check('  the same address again -> 409', s === 409, `status=${s} ${j?.error?.code}`);
  [s, j] = await req('POST', '/user/withdrawals/whitelist',
    { label: 'other chain', currency: 'ETH', address: 'TXk9probe1234567890abcdef' }, H);
  check('  the same address on ANOTHER currency is allowed', s === 201, `status=${s}`);
  const id2 = j?.data?.id;
  [s] = await req('POST', '/user/withdrawals/whitelist', { label: 'bad', currency: 'USDT', address: 'has space' }, H);
  check('  an address with whitespace -> 422', s === 422, `status=${s}`);

  [s, j] = await req('PUT', '/user/withdrawals/whitelist/enforcement', { enabled: true }, H);
  check('turning it ON now works', s === 200 && j?.data?.whitelistOnly === true, JSON.stringify(j?.data));
  [, j] = await get('/user/withdrawals/whitelist', H);
  check('  the list reflects it', j?.data?.whitelistOnly === true && j?.data?.addresses?.length === 2,
    `only=${j?.data?.whitelistOnly} n=${j?.data?.addresses?.length}`);
  [, j] = await req('PUT', '/user/withdrawals/whitelist/enforcement', { enabled: 'false' }, H);
  check('  enabled:"false" as a STRING turns it OFF (not coerced true)',
    j?.data?.whitelistOnly === false, JSON.stringify(j?.data));

  [s, j] = await req('PATCH', `/user/withdrawals/whitelist/${id}`, { label: 'Renamed' }, H);
  check('PATCH renames', s === 200 && j?.data?.label === 'Renamed', j?.data?.label);
  [s] = await req('PATCH', `/user/withdrawals/whitelist/${id}`, { address: 'TXnew' }, H);
  check('  but cannot change the ADDRESS', s === 422, `status=${s}`);

  const d1 = await login('demo_player01');
  const H1 = { authorization: 'Bearer ' + d1.accessToken };
  [, j] = await get('/user/withdrawals/whitelist', H1);
  check('another player sees none of them', j?.data?.addresses?.length === 0, `${j?.data?.addresses?.length}`);
  [s, j] = await req('DELETE', `/user/withdrawals/whitelist/${id}`, null, H1);
  check('  and cannot delete one -> 404', s === 404, `status=${s} ${j?.error?.code}`);

  await req('PUT', '/user/withdrawals/whitelist/enforcement', { enabled: true }, H);
  [s, j] = await req('DELETE', `/user/withdrawals/whitelist/${id}`, null, H);
  check('DELETE -> 200', s === 200, JSON.stringify(j?.data));
  [, j] = await req('DELETE', `/user/withdrawals/whitelist/${id2}`, null, H);
  check('  removing the LAST one turns enforcement off', j?.data?.whitelistOnly === false, JSON.stringify(j?.data));
  [, j] = await get('/user/withdrawals/whitelist', H);
  check('  confirmed on the list', j?.data?.whitelistOnly === false && j?.data?.addresses?.length === 0,
    `only=${j?.data?.whitelistOnly} n=${j?.data?.addresses?.length}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 14 — the rollover task list');
  [s] = await get('/user/wager/tasks');
  check('it needs a token', s === 401, `status=${s}`);
  [s, j] = await get('/user/wager/tasks', H);
  check('GET /user/wager/tasks -> 200', s === 200, JSON.stringify(j?.data).slice(0, 62));
  check('  it declares its SCOPE as account-wide', j?.data?.scope === 'account', j?.data?.scope);
  check('  a zero target lists NO task (not a completed one)', j?.data?.tasks?.length === 0,
    `${j?.data?.tasks?.length} task(s)`);

  /* The populated arm. `#totalApprovedDeposits` sums `fiat_deposits` where
     status='approved'; the demo player's only deposit is pending, so the task
     list is legitimately empty until one exists. */
  const { rows: [ins] } = await c.query(
    `insert into fiat_deposits (user_id, amount, status, created_at)
     values ($1,'1000','approved', now()) returning deposit_id`, [me.id]
  );
  seededDeposit = ins.deposit_id;

  [, j] = await get('/user/wager/tasks', H);
  const task = j?.data?.tasks?.[0];
  check('with an approved deposit the task appears', j?.data?.tasks?.length === 1, `${j?.data?.tasks?.length} task(s)`);
  check('  target = deposits x multiplier', task?.target === '3000.00000000',
    `basis=${task?.basis} x${j?.data?.multiplier} -> ${task?.target}`);
  check('  it is in_progress, not complete', task?.status === 'in_progress', task?.status);
  check('  and it reports the operator lock', 'locked' in (task ?? {}), `locked=${task?.locked}`);
  const [, prog] = await get('/user/wager/progress', H);
  check('  it agrees with /wager/progress exactly',
    task?.target === prog.data.target && task?.wagered === prog.data.wagered
      && task?.remaining === prog.data.remaining, '');
} finally {
  if (seededDeposit) await c.query('delete from fiat_deposits where deposit_id=$1', [seededDeposit]);
  await c.query('delete from user_withdrawal_whitelist where user_id=$1', [me.id]);
  await c.query('update users set withdraw_whitelist_only=false where id=$1', [me.id]);
  await c.end();
  console.log('\ncleaned up: the seeded deposit, the whitelist rows and the enforcement flag');

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

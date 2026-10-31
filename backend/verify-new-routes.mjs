/* Throwaway verification for the routes added on 2026-09-04 — gaps 12, 10, 20, 23 and 25.
 *
 *   cd "backend copy" && node verify-new-routes.mjs
 *
 * ── IT NEEDS RATE LIMITING OFF ──────────────────────────────────────────────
 *
 * Registration and password reset are metered at 5 an hour, which is the budget
 * the socket handlers carried and is right in production. This file makes about
 * seven registration calls, so with `RATE_LIMIT_ENABLED=true` everything after
 * the fifth answers `429 TOO_MANY_REQUESTS` and nine assertions fail together.
 * That is the limiter working, not a regression — if you see a wall of 429s,
 * set `RATE_LIMIT_ENABLED=false` in `.env`, restart, run this, and put it back.
 *
 * Cleans up the accounts and rows it creates. Nothing in src/ imports it.
 * Gaps 2 and 19 are `verify-tier2.js`, which drives the game engine instead.
 */
import crypto from 'node:crypto';
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
const DB = { host: '127.0.0.1', port: 5433, user: 'postgres', password: 'root', database: 'bc_games' };

const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n.padEnd(54)} ${String(d).slice(0, 62)}`);
};
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);

const post = async (p, body, headers = {}) => {
  const r = await fetch(B + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  let j = null;
  try { j = await r.json(); } catch { /* empty body */ }
  return [r.status, j];
};
const get = async (p, headers = {}) => {
  const r = await fetch(B + p, { headers });
  let j = null;
  try { j = await r.json(); } catch { /* empty body */ }
  return [r.status, j];
};
const del = async (p, headers = {}) => {
  const r = await fetch(B + p, { method: 'DELETE', headers });
  let j = null;
  try { j = await r.json(); } catch { /* empty body */ }
  return [r.status, j];
};

const c = new pg.Client(DB);
await c.connect();

const U = 'probe_' + Date.now();
const E = `${U}@demo.local`;
const PW = 'Probe@123456';
const NEW_PW = 'Rotated@98765';

try {
  // ══════════════════════════════════════════════════════════════════════
  section('gap 12 — register');
  let [s, j] = await post('/user/auth/register', {});
  check('empty body -> 422 with a field list', s === 422 && j?.error?.details?.fields?.length === 3,
    (j?.error?.details?.fields ?? []).map((f) => f.field).join(','));

  [s, j] = await post('/user/auth/register', { username: U, password: PW, email: E });
  check('register -> 201', s === 201, `status=${s} id=${j?.data?.id}`);
  check('  id is a STRING (bigint safety)', typeof j?.data?.id === 'string', typeof j?.data?.id);
  check('  no password echoed back', !JSON.stringify(j).toLowerCase().includes('probe@'), '');
  check('  no session minted — registering does not sign you in',
    !j?.data?.accessToken && !j?.data?.refreshToken, '');

  [s, j] = await post('/user/auth/login', { identifier: U, password: PW });
  check('the new account can LOG IN', s === 200 && !!j?.data?.accessToken, `status=${s}`);
  const token = j?.data?.accessToken;
  const H = { authorization: 'Bearer ' + token };

  [s, j] = await get('/user/auth/me', H);
  check('  its session works on an authed route', s === 200, `name=${j?.data?.username ?? j?.data?.name}`);

  [s, j] = await get('/user/wallet/balances', H);
  const bal = j?.data ?? {};
  check('  and it has a wallet (the Credits row was created)',
    Object.keys(bal).length > 0 && bal.INR === '0.00000000', `${Object.keys(bal).length} currencies`);

  [s, j] = await post('/user/auth/register', { username: U, password: PW, email: E });
  check('duplicate username -> 409, not 500', s === 409, `status=${s} ${j?.error?.code}`);
  [s] = await post('/user/auth/register', { username: 'ab', password: PW, email: E });
  check('username under 3 chars -> 422', s === 422, `status=${s}`);
  [s] = await post('/user/auth/register', { username: U + 'x', password: 'short', email: 'x@y.z' });
  check('weak password -> 422', s === 422, `status=${s}`);
  [s] = await post('/user/auth/register', { username: U + 'y', password: PW, email: E, nope: 1 });
  check('an unknown key -> 422 (.strict)', s === 422, `status=${s}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 12 — password reset');
  const [s1, j1] = await post('/user/auth/forgot-password', { email: E });
  const [s2, j2] = await post('/user/auth/forgot-password', { email: 'nobody@nowhere.invalid' });
  check('forgot-password -> 200 for a REAL address', s1 === 200, `status=${s1}`);
  check('  and 200 for an UNKNOWN one', s2 === 200, `status=${s2}`);
  check('  IDENTICAL body — no account enumeration',
    JSON.stringify(j1?.data) === JSON.stringify(j2?.data), JSON.stringify(j1?.data));

  [s, j] = await post('/user/auth/reset-password', { token: 'not-real', newPassword: 'Another@12345' });
  check('a bad token is refused', s >= 400, `status=${s} ${j?.error?.code}`);

  /* The service stores sha256(token) and emails the plaintext. SMTP is unset on this delivery,
     so plant a token we know, hashed the way `hashToken` does (packages/auth/src/password.js).
     This exercises the real `completePasswordReset`; only the delivery is bypassed. */
  const { rows: [user] } = await c.query('select id from users where name=$1', [U]);
  const plain = 'probe-token-' + crypto.randomBytes(8).toString('hex');
  await c.query(
    `insert into auth_verification_tokens (user_id, purpose, token_hash, expires_at, created_at)
     values ($1,'password_reset',$2, now() + interval '30 minutes', now())`,
    [user.id, crypto.createHash('sha256').update(plain).digest('hex')]
  );

  [s, j] = await post('/user/auth/reset-password', { token: plain, newPassword: NEW_PW });
  check('reset with a REAL token -> 200', s === 200, JSON.stringify(j?.data));
  [s] = await post('/user/auth/login', { identifier: U, password: NEW_PW });
  check('  the NEW password works', s === 200, `status=${s}`);
  [s, j] = await post('/user/auth/login', { identifier: U, password: PW });
  check('  the OLD password does not', s === 401, `status=${s} ${j?.error?.code}`);
  [s, j] = await post('/user/auth/reset-password', { token: plain, newPassword: 'Third@1234567' });
  check('  the token is SINGLE USE', s >= 400, `status=${s} ${j?.error?.code}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 20 — joinedAt is a date, not a boolean');
  const [, demo] = await post('/user/auth/login', { identifier: 'demo_player03', password: demoPassword('demo_player03') });
  const DH = { authorization: 'Bearer ' + demo.data.accessToken };
  [s, j] = await get('/user/profile', DH);
  const joined = j?.data?.joinedAt;
  check('joinedAt is no longer a boolean', typeof joined === 'string', JSON.stringify(joined));
  check('  and it parses to a real date, not 1970',
    !!joined && new Date(joined).getFullYear() > 2000, joined);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 10 — the notification inbox');
  const { rows: [d3] } = await c.query(`select id from users where name='demo_player03'`);
  await c.query('delete from user_notifications where user_id=$1', [d3.id]);
  for (const [t, b] of [['Welcome', 'Thanks for joining'], ['Deposit received', 'INR 500 credited'], ['Bonus ready', 'Claim it']]) {
    await c.query(
      `insert into user_notifications (user_id,title,body,type,is_read,delivered,created_at)
       values ($1,$2,$3,'general',false,true,now())`, [d3.id, t, b]
    );
  }

  [s, j] = await get('/user/notifications', DH);
  check('GET /user/notifications returns the 3 rows', s === 200 && j?.data?.length === 3, `${j?.data?.length} rows`);
  check('  the total survives the internal hop', j?.meta?.total === 3, JSON.stringify(j?.meta));
  check('  a row carries title and body', !!j?.data?.[0]?.title && !!j?.data?.[0]?.body, j?.data?.[0]?.title);
  check('  newest first', j?.data?.[0]?.title === 'Bonus ready', j?.data?.[0]?.title);

  [s, j] = await get('/user/notifications/unread-count', DH);
  check('unread-count = 3', j?.data?.unread === 3, JSON.stringify(j?.data));

  const firstId = (await get('/user/notifications', DH))[1].data[0].id;
  [s, j] = await post(`/user/notifications/${firstId}/read`, {}, DH);
  check('marking ONE read affects exactly 1', j?.data?.marked === 1, JSON.stringify(j?.data));
  [, j] = await get('/user/notifications/unread-count', DH);
  check('  unread drops to 2', j?.data?.unread === 2, JSON.stringify(j?.data));

  [, j] = await get('/user/notifications?unreadOnly=true', DH);
  check('  unreadOnly=true returns 2', j?.data?.length === 2, `${j?.data?.length} rows`);
  [, j] = await get('/user/notifications?unreadOnly=false', DH);
  check('  unreadOnly=FALSE returns all 3 (not coerced to true)', j?.data?.length === 3, `${j?.data?.length} rows`);

  [, j] = await post('/user/notifications/read-all', {}, DH);
  check('read-all marks the remaining 2', j?.data?.marked === 2, JSON.stringify(j?.data));
  check('  and did NOT match the /:id/read route', j?.data?.marked !== undefined, '');
  [, j] = await post('/user/notifications/read-all', {}, DH);
  check('  read-all again marks 0 (idempotent)', j?.data?.marked === 0, JSON.stringify(j?.data));
  [, j] = await get('/user/notifications', DH);
  check('  the rows are still there, just read', j?.data?.length === 3 && j.data.every((x) => x.read), `${j?.data?.length} rows`);

  [, j] = await post('/user/notifications/999999999/read', {}, DH);
  check('a foreign notification id marks nothing', j?.data?.marked === 0, JSON.stringify(j?.data));
  const [, other] = await post('/user/auth/login', { identifier: 'demo_player01', password: demoPassword('demo_player01') });
  [, j] = await get('/user/notifications', { authorization: 'Bearer ' + other.data.accessToken });
  check('another player sees NONE of them', (j?.data?.length ?? 0) === 0, `${j?.data?.length} rows`);
  [s] = await get('/user/notifications?limit=0', DH);
  check('limit=0 is refused by the validator', s === 422, `status=${s}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 25 — sign one device out');
  const [, second] = await post('/user/auth/login',
    { identifier: 'demo_player03', password: demoPassword('demo_player03'), deviceLabel: 'probe-device' });
  [, j] = await get('/user/auth/sessions', DH);
  const target = (j?.data ?? []).find((x) => x.device_label === 'probe-device');
  check('the second device is listed', !!target, `id=${target?.id}`);

  [s, j] = await del('/user/auth/sessions/' + target.id, DH);
  check('DELETE /sessions/:id -> 200', s === 200, JSON.stringify(j?.data));
  [, j] = await get('/user/auth/sessions', DH);
  check('  it is gone from the list', !(j?.data ?? []).some((x) => String(x.id) === String(target.id)), '');

  /* REVOCATION STOPS THE REFRESH, NOT THE ACCESS TOKEN — and that is the platform's own
     behaviour, not this route's: `logout` was measured the same way and an already-issued
     access token keeps working there too until it expires. */
  [s] = await post('/user/auth/refresh', { refreshToken: second.data.refreshToken });
  check('  that device can no longer REFRESH', s === 401, `status=${s}`);
  [s] = await get('/user/auth/me', { authorization: 'Bearer ' + second.data.accessToken });
  check('  (its access token lives to expiry, as logout behaves)', s === 200, `status=${s}`);
  [s] = await get('/user/auth/me', DH);
  check('  while THIS session still works', s === 200, `status=${s}`);
  [s, j] = await del('/user/auth/sessions/' + target.id, DH);
  check('  removing it again -> 404, not 401', s === 404, `status=${s} ${j?.error?.code}`);
  [s] = await del('/user/auth/sessions/abc', DH);
  check('  a non-numeric id -> 422', s === 422, `status=${s}`);

  // ══════════════════════════════════════════════════════════════════════
  section('gap 23 — change email');
  [s, j] = await post('/user/profile/change-email', {}, DH);
  check('POST /user/profile/change-email is a ROUTE now', s === 422, `status=${s} ${j?.error?.code}`);
  [s, j] = await post('/user/profile/change-email', { email: 'x@y.zz', code: '000000' }, DH);
  check('  a wrong code is refused (not a 404)', s >= 400 && s !== 404, `status=${s} ${j?.error?.code}`);
} finally {
  // ── clean up ────────────────────────────────────────────────────────────
  const { rows } = await c.query(`select id from users where name like 'probe\\_%'`);
  for (const r of rows) {
    await c.query('delete from auth_verification_tokens where user_id=$1', [r.id]);
    await c.query('delete from auth_sessions where user_id=$1', [r.id]);
    await c.query('delete from credits where uid=$1', [r.id]);
    await c.query('delete from users where id=$1', [r.id]);
  }
  await c.query(`delete from auth_login_attempts where identifier like 'probe\\_%'`);
  const { rows: [d3] } = await c.query(`select id from users where name='demo_player03'`);
  if (d3) await c.query('delete from user_notifications where user_id=$1', [d3.id]);
  await c.end();
  console.log(`\ncleaned up: ${rows.length} probe account(s) and the seeded notifications`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

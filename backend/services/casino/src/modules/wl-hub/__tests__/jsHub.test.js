'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { JsHubProvider } = require('../jsHubProvider');
const crypto = require('node:crypto');
const { forwardJs, jsRounds, jsAlias, jsPlayerByAlias, JS_ALIAS_FROM } = require('../forward');
const { providerAnswer } = require('../../js-games/controllers');
const { JsGamesService, displayAmount } = require('../../js-games/jsGames.service');
const { XGamesApiClient } = require('../../js-games/providers/xgamesApi');
const { buildJsGamesService } = require('../../js-games/jsGames.factory');

/**
 * JSGames V2 through the casino hub, without a database: a copy's launch goes to the parent, the
 * parent passes a copy player's verified callback on, and a copy settles only what its parent sent.
 */

const callback = (over = {}) => ({ user_id: '10000000042', game_uid: 'g1', game_round: 'r-1', serial_number: 's-1', bet_amount: '10', win_amount: '0', currency: 'INR', ...over });
const service = (config, extra = {}) => new JsGamesService({ models: {}, db: {}, config, logger: null, ...extra });

test('copy: the V2 client is the hub, and a launch is one signed call to the parent', async () => {
  const built = buildJsGamesService({ config: { WHITELABEL_MODE: true }, models: {}, db: {} });
  assert.ok(built.v2 instanceof JsHubProvider);
  assert.equal(built.v2.configured, true);

  const calls = [];
  const hub = new JsHubProvider({ any: 1 }, async (...args) => (calls.push(args), { success: true, data: { game_launch_url: 'https://g/x', session_token: 't' } }));
  const answer = await hub.request('/launch', { method: 'POST', body: { user_id: '42', game_uid: 'g1' } });
  assert.equal(answer.data.game_launch_url, 'https://g/x');
  assert.deepEqual(calls[0].slice(1), ['POST', '/js/provider', { method: 'POST', path: '/launch', body: { user_id: '42', game_uid: 'g1' } }]);
});

test('copy: a parent refusal reads as refused, an unreachable parent as failed', async () => {
  const refusing = new JsHubProvider({}, async () => { throw Object.assign(new Error('no'), { refused: true, status: 422, code: 'JSGAMES_UPSTREAM_REJECTED' }); });
  await assert.rejects(refusing.request('/launch', { method: 'POST', body: {} }), (e) => e.status === 422 && e.code === 'JSGAMES_UPSTREAM_REJECTED');
  const down = new JsHubProvider({}, async () => { throw new Error('hub unreachable'); });
  await assert.rejects(down.request('/launch', { method: 'POST', body: {} }), (e) => e.status === 502);
});

test('parent (not a copy) still builds the real JSGames client', () => {
  const built = buildJsGamesService({ config: { WHITELABEL_MODE: false, JSGAMES_V2_BASE_URL: 'https://x', JSGAMES_V2_API_KEY: 'k', JSGAMES_V2_API_SECRET: 's' }, models: {}, db: {} });
  assert.ok(built.v2 instanceof XGamesApiClient);
});

/** A callback as the provider sends it: raw bytes, `X-Timestamp`, `X-Signature` over `<ts>.<raw>`. */
const signed = (v2, body, extra = {}) => {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Date.now());
  return { body, rawBody, headers: { 'x-timestamp': timestamp, 'x-signature': v2.signCallback(timestamp, rawBody), ...extra } };
};
const realClient = () => new XGamesApiClient({ baseUrl: 'https://x/api/game', apiKey: 'k', apiSecret: 's' });

test('copy: a callback arriving directly is refused; nothing is read or moved', async () => {
  const svc = service({ WHITELABEL_MODE: true }, { v2: new JsHubProvider({}) });
  assert.deepEqual(await svc.betCallbackV2({ body: callback({ user_id: '1705297674' }), rawBody: '{}', headers: {} }), { success: false, error: 'Unauthorised' });
});

test('parent: `trusted` is ignored — an unsigned callback is refused even when marked trusted', async () => {
  const svc = service({ WHITELABEL_MODE: false }, { v2: realClient() });
  assert.deepEqual(await svc.betCallbackV2({ body: callback(), rawBody: JSON.stringify(callback()), headers: {}, trusted: true }), { success: false, error: 'Unauthorised' });
});

test('parent: a verified callback for a copy’s alias is passed on, and the copy’s answer returned', async () => {
  const v2 = realClient();
  const passed = [];
  const hub = {
    JS_ALIAS_FROM,
    jsPlayerByAlias: async (_deps, alias) => (alias === 10_000_000_042 ? { whitelabelId: 7, playerId: '1705297674' } : null),
    forwardJs: async (_deps, args) => (passed.push(args), { success: true, new_balance: '990' }),
  };
  const svc = service({ WHITELABEL_MODE: false }, { v2, hub });
  const body = callback({ user_id: '10000000042' });
  assert.deepEqual(await svc.betCallbackV2(signed(v2, body)), { success: true, new_balance: '990' });
  assert.equal(passed.length, 1);
  assert.equal(passed[0].whitelabelId, 7);
  assert.equal(passed[0].playerId, '1705297674');

  // An alias nobody was issued, and a forged callback, never reach a copy.
  assert.deepEqual(await svc.betCallbackV2(signed(v2, callback({ user_id: '10000000099' }))), { success: false, error: 'Invalid payload' });
  const forged = signed(v2, body);
  forged.rawBody = JSON.stringify({ ...body, win_amount: '5000' });
  assert.deepEqual(await svc.betCallbackV2(forged), { success: false, error: 'Unauthorised' });
  assert.equal(passed.length, 1);
});

test('parent: the provider’s test callback passes with a balance and moves nothing', async () => {
  const v2 = realClient();
  const svc = service({ WHITELABEL_MODE: false }, { v2, hub: { JS_ALIAS_FROM, jsPlayerByAlias: async () => assert.fail('no lookup'), forwardJs: async () => assert.fail('not passed on') } });
  const probe = signed(v2, callback({ user_id: '10000000042', bet_amount: 0, win_amount: 0 }), { 'x-test-callback': '1' });
  assert.deepEqual(await svc.betCallbackV2(probe), { success: true, test: true, new_balance: '0' });
});

test('the answer is the provider’s wire format', () => {
  assert.deepEqual(providerAnswer({ success: true, new_balance: '990.50000000' }), { status: 200, body: { new_balance: 990.5 } });
  assert.deepEqual(providerAnswer({ success: true, duplicate: true, new_balance: '5' }), { status: 200, body: { new_balance: 5 } });
  assert.deepEqual(providerAnswer({ success: false, error: 'Insufficient balance', new_balance: '1' }), { status: 400, body: { code: 'INSUFFICIENT_USER_BALANCE' } });
  assert.deepEqual(providerAnswer({ success: false, error: 'Unauthorised' }), { status: 401, body: { code: 'INVALID_SIGNATURE' } });
  assert.deepEqual(providerAnswer({ success: false, error: 'Server error' }), { status: 500, body: { code: 'SERVER_ERROR' } });
  assert.equal(providerAnswer({ success: false, error: 'Unsupported currency' }).status, 400);
  assert.equal(providerAnswer(undefined).status, 500);
});

test('outbound calls carry signature version 2 over the exact bytes sent', async () => {
  const sent = [];
  const v2 = new XGamesApiClient({ baseUrl: 'https://x/api/game', apiKey: 'k', apiSecret: 's', fetchImpl: async (url, init) => (sent.push({ url, init }), { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }) });
  await v2.request('/launch', { method: 'POST', body: { game_uid: 'g', user_id: '1001', currency_code: 'INR', credit_amount: '100' } });
  const { init } = sent[0];
  const h = init.headers;
  const canonical = ['POST', '/api/game/launch', '', crypto.createHash('sha256').update(init.body).digest('hex'), h['x-timestamp'], h['x-nonce']].join('\n');
  assert.equal(h['x-signature'], crypto.createHmac('sha256', 's').update(canonical).digest('hex'));
  assert.equal(h['x-signature-version'], '2');
  assert.equal(h['x-api-key'], 'k');
  assert.match(h['x-nonce'], /^[0-9a-f]{8,64}$/);
});

test('the launch balance is the guide’s form', () => {
  assert.deepEqual(['925.50000000', '7.00000000', '0.019', '100', null].map(displayAmount), ['925.50', '7', '0.01', '100', '0']);
});

test('forwardJs: the copy gets its own player id; an accepted round is recorded once for the report', async () => {
  const recorded = [];
  const deps = { db: { sequelize: { query: async (_sql, opts) => (recorded.push(opts.replacements), []) } }, logger: null };
  const sent = [];
  const hub = {
    whitelabelById: async (_d, id) => ({ id, status: 'live', secret: 'x' }),
    callCopy: async (_wl, method, path, body) => (sent.push({ method, path, body }), { success: true, new_balance: '990' }),
  };
  const body = callback({ bet_amount: '10', win_amount: '25' });
  const answer = await forwardJs(deps, { whitelabelId: 7, playerId: '1705297674', body }, hub);
  assert.deepEqual(answer, { success: true, new_balance: '990' });
  assert.equal(sent[0].path, '/in/js');
  assert.equal(sent[0].body.user_id, '1705297674');
  assert.deepEqual(recorded.map((r) => [r.provider, r.kind, r.amount, r.transactionId]), [
    ['js', 'bet', '10.00000000', '7:1705297674:r-1:s-1'],
    ['js', 'win', '25.00000000', '7:1705297674:r-1:s-1'],
  ]);

  // A duplicate, a refusal, a silent copy and an unknown whitelabel record nothing.
  recorded.length = 0;
  await forwardJs(deps, { whitelabelId: 7, playerId: '1', body }, { ...hub, callCopy: async () => ({ success: true, duplicate: true, new_balance: '1' }) });
  await forwardJs(deps, { whitelabelId: 7, playerId: '1', body }, { ...hub, callCopy: async () => ({ success: false, error: 'Insufficient balance' }) });
  assert.deepEqual(await forwardJs(deps, { whitelabelId: 7, playerId: '1', body }, { ...hub, callCopy: async () => { throw new Error('down'); } }), { success: false, error: 'Server error' });
  assert.deepEqual(await forwardJs(deps, { whitelabelId: 9, playerId: '1', body }, { ...hub, whitelabelById: async () => null }), { success: false, error: 'Invalid payload' });
  assert.equal(recorded.length, 0);
});

test('jsRounds: only the amounts that moved; ids are per whitelabel, player, round and serial', () => {
  assert.deepEqual(jsRounds({ whitelabelId: 1, playerId: '2', body: callback({ bet_amount: '0', win_amount: '0' }) }), []);
  assert.deepEqual(jsRounds({ whitelabelId: 1, playerId: '2', body: callback({ bet_amount: '5', win_amount: '0' }) }).map((r) => r.kind), ['bet']);
});

test('aliases: issued by the parent, 11 digits, and resolved back to the copy’s player', async () => {
  const rows = new Map();
  const deps = { db: { sequelize: { query: async (sql, { replacements: r }) => {
    if (/INSERT INTO whitelabel_js_players/.test(sql)) {
      const key = `${r.whitelabelId}:${r.playerId}`;
      if (!rows.has(key)) rows.set(key, String(JS_ALIAS_FROM + rows.size));
      return [{ alias: rows.get(key) }];
    }
    const hit = [...rows.entries()].find(([, alias]) => alias === r.alias);
    return hit ? [{ whitelabel_id: Number(hit[0].split(':')[0]), player_id: hit[0].split(':')[1] }] : [];
  } } } };
  const a = await jsAlias(deps, { whitelabelId: 5, playerId: '1705297674' });
  assert.equal(a, 10_000_000_000);
  assert.equal(String(a).length, 11);
  assert.equal(await jsAlias(deps, { whitelabelId: 5, playerId: '1705297674' }), a, 'the same player keeps its alias');
  assert.notEqual(await jsAlias(deps, { whitelabelId: 6, playerId: '1705297674' }), a, 'the same id on another copy is another player');
  assert.deepEqual(await jsPlayerByAlias(deps, a), { whitelabelId: 5, playerId: '1705297674' });
  assert.equal(await jsPlayerByAlias(deps, 10_000_009_999), null);
});

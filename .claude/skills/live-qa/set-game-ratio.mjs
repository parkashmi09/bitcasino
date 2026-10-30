#!/usr/bin/env node
// Set every Game ratio exception (each provider / game with its own %) to one %.
// Runs inside the signed-in site admin tab (Chrome CDP), so it is the admin's own save — the same
// PUT the Bonus → Wager contribution screen sends, logged in the Activity log.
//   node .claude/skills/live-qa/set-game-ratio.mjs <percent> [--types <percent>] [--admin <url>]
// The admin is ADMIN_URL / --admin (default: this site's local admin). CDP is CDP_URL (default
// http://127.0.0.1:9333). The game types (Slots / Originals / Live casino / Sports) are left as
// they are unless --types is given. The rules before the change are saved to
// logs/qa/wager-ratio/before-<time>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Per copy: this site's local admin, and a package in this repo that has `ws` installed.
const DEFAULT_ADMIN = 'http://localhost:3090';
const WS_FROM = 'admin/package.json';

const ROOT = new URL('../../../', import.meta.url);
const require = createRequire(new URL(WS_FROM, ROOT));
const WebSocket = require('ws');

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const pct = args[0];
const typesPct = opt('--types');
const admin = opt('--admin') ?? process.env.ADMIN_URL ?? (DEFAULT_ADMIN.startsWith('http') ? DEFAULT_ADMIN : null);
const cdp = process.env.CDP_URL ?? 'http://127.0.0.1:9333';
const valid = (p) => p != null && /^\d+(\.\d+)?$/.test(p) && Number(p) <= 100;
if (!valid(pct) || (typesPct != null && !valid(typesPct)) || !admin) {
  console.error('usage: [ADMIN_URL=<admin url>] set-game-ratio.mjs <percent 0-100> [--types <percent 0-100>] [--admin <url>]');
  process.exit(2);
}

const origin = new URL(admin).origin;
const tabs = await (await fetch(`${cdp}/json/list`)).json();
const tab = tabs.find((t) => t.type === 'page' && t.url.startsWith(`${origin}/`) && !t.url.includes('/owner'));
if (!tab) throw new Error(`Open the site admin (${origin}) signed in, in the CDP Chrome (${cdp})`);

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const evaluate = (expression) =>
  new Promise((resolve) => {
    const my = ++id;
    ws.on('message', function on(m) {
      const j = JSON.parse(m);
      if (j.id !== my) return;
      ws.off('message', on);
      resolve(j.result?.result?.value);
    });
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });

const PATH = '/api/gw/api/v1/admin/site-config/wager-contribution';
const read = async () => {
  const raw = await evaluate(`fetch('${PATH}', { cache: 'no-store' }).then((r) => r.text())`);
  const rules = JSON.parse(raw ?? 'null')?.data?.rules;
  if (!rules) throw new Error('Could not read the rules: ' + String(raw).slice(0, 200));
  return rules;
};

const before = await read();
mkdirSync(new URL('logs/qa/wager-ratio/', ROOT), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(new URL(`logs/qa/wager-ratio/before-${stamp}.json`, ROOT), JSON.stringify({ takenAt: new Date().toISOString(), admin: origin, rules: before }, null, 1));

const rules = before.map((r) => ({
  category: r.category,
  provider: r.provider,
  gameRef: r.gameRef,
  percent: r.category ? (typesPct ?? r.percent) : pct,
}));
const put = JSON.parse(
  await evaluate(
    `fetch('${PATH}', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ rules }))} }).then(async (r) => JSON.stringify({ status: r.status, body: await r.text() }))`
  )
);
if (put.status !== 200) {
  console.error('Save refused:', put.status, put.body.slice(0, 300));
  process.exit(1);
}

const after = await read();
const wrong = after.filter((r) => String(Number(r.percent)) !== String(Number(r.category ? (typesPct ?? before.find((b) => b.category === r.category)?.percent) : pct)));
console.log(`Saved ${after.length} rules on ${origin} (backup: logs/qa/wager-ratio/before-${stamp}.json)`);
for (const r of after) console.log(`  ${(r.category ? `type ${r.category}` : r.provider ? `provider ${r.provider}` : `${r.gameName ?? r.gameRef}${r.gameProvider ? ` · ${r.gameProvider}` : ''}`).padEnd(48)} ${r.percent}%`);
console.log(wrong.length ? `MISMATCH on ${wrong.length} rule(s)` : 'Verified: every rule reads back as set.');
ws.close();
process.exit(wrong.length ? 1 : 0);

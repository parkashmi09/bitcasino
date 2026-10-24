'use strict';

const { QueryTypes } = require('sequelize');

const { FANCY_GT, NOT_BACKLAY, BET, LEDGER, EXPOSURE } = require('./checks');

/**
 * System Tracker > Account Trace — zip ka `systemTracker/verifier.js`.
 *
 * Ek account ki rule-by-rule jaanch. Sirf padhta hai. Player ke liye: wallet, P/L, exposure,
 * point ledger, hierarchy aur sports bets. Staff / owner ke liye: wallet, point ledger,
 * hierarchy (wo bet nahi lagate).
 *
 * Har rule: { label, expected, actual, diff, pass, info?, note?, subs? }
 */

// Zip jaisa: settlement wali P/L rows.
const PL_WHERE = `(LOWER(reason) IN ('settlement','settlement_void','commission','commission_void'))`;

const q = (sequelize, sql, replacements = {}) => sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Number(num(v).toFixed(2));

/** Ek rule — expected vs actual, 0.01 tak barabar = pass. */
const chk = (label, expected, actual, extra = {}) => {
  const diff = r2(num(actual) - num(expected));
  return { label, expected: r2(expected), actual: r2(actual), diff, pass: Math.abs(diff) <= 0.01, ...extra };
};
const catVerdict = (rules) => rules.every((r) => r.pass || r.info);

/** Autocomplete — players aur staff, naam ya id se (2+ akshar). */
async function searchAccounts(sequelize, text) {
  if (!text || String(text).trim().length < 2) return [];
  const like = `%${String(text).trim()}%`;
  return q(
    sequelize,
    `SELECT * FROM (
        SELECT CAST(u.id AS TEXT) AS user_id, u.name AS username, 'USER' AS role, 'user' AS kind
          FROM public.users u WHERE u.name ILIKE :like OR CAST(u.id AS TEXT) ILIKE :like
        UNION ALL
        SELECT CAST(s.id AS TEXT), s.name, COALESCE(r.name, 'STAFF'), CASE WHEN r.level = 1 THEN 'owner' ELSE 'staff' END
          FROM public.staff s LEFT JOIN public.roles r ON r.id = s.role_id
         WHERE s.name ILIKE :like OR CAST(s.id AS TEXT) ILIKE :like
     ) s ORDER BY (kind <> 'user'), username LIMIT 25`,
    { like }
  );
}

/** id ya naam → account. Pehle player, phir staff (zip jaisa order). */
async function resolveAccount(sequelize, key) {
  const k = String(key);
  const [user] = await q(
    sequelize,
    `SELECT CAST(u.id AS TEXT) AS id, u.name AS username, 'USER' AS role, 'user' AS kind, u.parent_staff_id,
            c.id AS wallet_id
       FROM public.users u LEFT JOIN public.credits c ON c.uid = u.id
      WHERE CAST(u.id AS TEXT) = :k OR u.name = :k LIMIT 1`,
    { k }
  );
  if (user) return user;
  const [staff] = await q(
    sequelize,
    `SELECT CAST(s.id AS TEXT) AS id, s.name AS username, COALESCE(r.name, 'STAFF') AS role,
            CASE WHEN r.level = 1 THEN 'owner' ELSE 'staff' END AS kind, s.parent_id AS parent_staff_id,
            c.id AS wallet_id
       FROM public.staff s
       LEFT JOIN public.roles r ON r.id = s.role_id
       LEFT JOIN public.credits c ON c.staff_id = s.id
      WHERE CAST(s.id AS TEXT) = :k OR s.name = :k LIMIT 1`,
    { k }
  );
  return staff ?? null;
}

/** Upar ki chain, owner tak. Toota link ho to `broken`. */
async function buildUpline(sequelize, account) {
  const path = [];
  const seen = new Set();
  let staffId = account.parent_staff_id;
  while (staffId && !seen.has(String(staffId)) && path.length < 12) {
    seen.add(String(staffId));
    const [p] = await q(
      sequelize,
      `SELECT CAST(s.id AS TEXT) AS id, s.name AS username, COALESCE(r.name, 'STAFF') AS role, r.level,
              s.parent_id, c.id AS wallet_id, ROUND(COALESCE(c.inr,0)::numeric,2) AS inr_balance
         FROM public.staff s
         LEFT JOIN public.roles r ON r.id = s.role_id
         LEFT JOIN public.credits c ON c.staff_id = s.id
        WHERE s.id = :id LIMIT 1`,
      { id: staffId }
    );
    if (!p) {
      path.push({ kind: 'staff', id: String(staffId), username: null, broken: true });
      break;
    }
    path.push({ kind: Number(p.level) === 1 ? 'owner' : 'staff', ...p });
    staffId = p.parent_id;
  }
  return path;
}

/** Point ledger — all_point = SUM(delta), event type wise subs. */
async function pointLedgerCategory(sequelize, walletId) {
  const [w] = await q(sequelize, 'SELECT all_point, credit FROM public.credits WHERE id = :walletId', { walletId });
  const [sum] = await q(sequelize, 'SELECT COALESCE(SUM(delta),0) AS s FROM mssports.point_ledger WHERE wallet_id = :walletId', { walletId });
  const byType = await q(
    sequelize,
    `SELECT event_type, COUNT(*) AS n, COALESCE(SUM(delta),0) AS s
       FROM mssports.point_ledger WHERE wallet_id = :walletId GROUP BY event_type ORDER BY event_type`,
    { walletId }
  );
  const rules = [
    chk('Wallet all_point = SUM(point_ledger deltas)', sum?.s, w?.all_point, {
      subs: byType.map((t) => ({ label: t.event_type, note: `${t.n} entr(ies)`, actual: r2(t.s), pass: true })),
    }),
    chk('Client(P/L) = all_point − credit', num(w?.all_point) - num(w?.credit), num(w?.all_point) - num(w?.credit), {
      info: true,
      note: `credit ${r2(w?.credit)} · all_point ${r2(w?.all_point)}`,
    }),
  ];
  return { key: 'ledger', label: 'Point Ledger', icon: 'ledger', rules, pass: catVerdict(rules) };
}

/** Hierarchy — chain owner tak pahunchti hai, aur direct downline. */
async function hierarchyCategory(sequelize, account, upline) {
  const broken = upline.some((u) => u.broken);
  const topIsOwner = account.kind === 'owner' || (upline.length && upline[upline.length - 1].kind === 'owner');
  const directUser = account.kind === 'user' && !account.parent_staff_id;
  const rules = [
    {
      label: 'Upline chain reaches an owner',
      expected: 1,
      actual: broken || !(topIsOwner || directUser) ? 0 : 1,
      diff: 0,
      pass: !broken && (topIsOwner || directUser),
      note: directUser ? 'direct user — no parent, settles with the owner' : upline.map((u) => u.username ?? `#${u.id}`).join(' → ') || '—',
    },
  ];
  if (account.kind !== 'user') {
    const kids = await q(
      sequelize,
      `SELECT s.name AS username, COALESCE(r.name,'STAFF') AS role, COALESCE(c.inr,0) AS inr_balance
         FROM public.staff s LEFT JOIN public.roles r ON r.id = s.role_id LEFT JOIN public.credits c ON c.staff_id = s.id
        WHERE s.parent_id = :id
       UNION ALL
       SELECT u.name, 'USER', COALESCE(c.inr,0)
         FROM public.users u LEFT JOIN public.credits c ON c.uid = u.id
        WHERE u.parent_staff_id = :id
       ORDER BY 1 LIMIT 200`,
      { id: account.id }
    );
    rules.push({
      label: 'Direct downline',
      expected: kids.length,
      actual: kids.length,
      diff: 0,
      pass: true,
      info: true,
      subs: kids.map((k) => ({ label: `${k.username} (${k.role})`, actual: r2(k.inr_balance), pass: true })),
    });
  }
  return { key: 'hierarchy', label: 'Hierarchy', icon: 'hierarchy', rules, pass: catVerdict(rules) };
}

/** Player ka worst-case exposure, market-aware (team MIN / fancy SUM) — zip jaisa. */
async function derivedExposure(sequelize, uid) {
  const [row] = await q(
    sequelize,
    `SELECT COALESCE(SUM(grp),0) AS exp FROM (
        SELECT LEAST(0, MIN(exposure_amount)) AS grp FROM ${EXPOSURE}
         WHERE user_id = :uid AND category <> 'casino' AND game_type IS NOT NULL
           AND game_type NOT IN ${FANCY_GT} AND game_type NOT LIKE '%Overs Line%' AND ${NOT_BACKLAY}
         GROUP BY match_id, game_type, event_id
        UNION ALL
        SELECT LEAST(exposure_amount,0) FROM ${EXPOSURE}
         WHERE user_id = :uid AND (category='casino' OR game_type IS NULL OR game_type IN ${FANCY_GT} OR game_type LIKE '%Overs Line%') AND ${NOT_BACKLAY}
     ) s`,
    { uid }
  );
  return num(row?.exp);
}

/** Sports bets — selection, jeete hue paid, void ka audit, manual result. */
async function sportsCategory(sequelize, uid) {
  const bets = await q(
    sequelize,
    `SELECT id, game_type, market_type, selection_name, status, result_status, eventid, match_id
       FROM ${BET} WHERE user_id = :uid ORDER BY id`,
    { uid }
  );
  const settled = new Set(
    (await q(sequelize, `SELECT DISTINCT bet_id FROM ${LEDGER} WHERE user_id = :uid AND category = 'SPORTS' AND LOWER(reason) = 'settlement'`, {
      uid: String(uid),
    })).map((r) => String(r.bet_id))
  );
  const audited = new Set(
    (await q(sequelize, `SELECT DISTINCT bet_id FROM mssports.bet_void_audit WHERE bet_kind = 'SPORTS' AND user_id = :uid`, { uid })).map((r) =>
      String(r.bet_id)
    )
  );
  const manualEvents = new Set((await q(sequelize, 'SELECT DISTINCT eventid FROM mssports.mannual_result')).map((r) => String(r.eventid)));

  const betSub = (b, note) => ({ label: `Bet #${b.id}`, note, pass: false });
  const noSelection = bets.filter((b) => !b.selection_name);
  const unpaidFancy = bets.filter((b) => b.game_type === 'FAN' && String(b.result_status).toLowerCase() === 'won' && !settled.has(String(b.id)));
  const voided = bets.filter((b) => ['refunded', 'void', 'refund'].includes(String(b.result_status).toLowerCase()));
  const notAudited = voided.filter((b) => !audited.has(String(b.id)));
  const manual = bets.filter((b) => manualEvents.has(String(b.eventid)));

  const rule = (label, list, note, extra = {}) => ({
    label,
    severity: 'high',
    expected: 0,
    actual: list.length,
    diff: list.length,
    pass: list.length === 0,
    subs: list.slice(0, 50).map((b) => betSub(b, note(b))),
    ...extra,
  });

  const rules = [
    rule('Selection is present on every bet', noSelection, (b) => `${b.market_type || ''} — selection missing`),
    rule('Winning fancy bets are paid out', unpaidFancy, (b) => `${b.selection_name || ''} won but no settlement row`),
    rule('Every voided bet has a bet_void_audit row', notAudited, (b) => `${b.market_type || ''} — ${b.result_status}`),
    rule('Manually-settled bets (admin-declared result)', manual, (b) => `${b.selection_name || ''} · ${b.market_type || ''} — settled ${b.result_status}`, {
      severity: 'review',
      info: true,
      pass: true,
    }),
  ];
  return { key: 'sports', label: 'Sports', icon: 'sports', rules, pass: catVerdict(rules), betCount: bets.length };
}

async function buildBettorReport(sequelize, account) {
  const uid = account.id;
  const [w] = await q(sequelize, 'SELECT inr FROM public.credits WHERE uid = :uid LIMIT 1', { uid });
  const [te] = await q(sequelize, 'SELECT total_exposure FROM mssports.total_exposures WHERE user_id = :uid LIMIT 1', { uid });
  const [counters] = await q(sequelize, 'SELECT profit, net_win, net_loss FROM mssports.users WHERE user_id = :uid LIMIT 1', { uid });

  // Hamare yahan bet lagte hi liability inr se kat jaati hai: available = inr, locked = |exposure|.
  const available = num(w?.inr);
  const storedExp = num(te?.total_exposure);
  const derived = await derivedExposure(sequelize, uid);
  const locked = Math.abs(storedExp);

  const snapshot = {
    kind: 'user',
    user_id: uid,
    username: account.username,
    role: account.role,
    total_balance: r2(available + locked),
    available_balance: r2(available),
    locked_exposure: r2(locked),
    net_exposure: r2(storedExp),
  };

  const categories = [];
  const walletRules = [
    chk('Locked funds equal the re-derived worst-case exposure', Math.abs(derived), locked),
    chk('Available balance is not negative', Math.max(0, available), available),
  ];
  categories.push({ key: 'wallet', label: 'Wallet Integrity', icon: 'wallet', rules: walletRules, pass: catVerdict(walletRules) });

  // P/L — ledger hi sach hai; stored counters sirf saath me dikhte hain.
  const [pl] = await q(sequelize, `SELECT COALESCE(SUM(profit),0) AS p, COALESCE(SUM(loss),0) AS l FROM ${LEDGER} WHERE user_id = :uid AND ${PL_WHERE}`, {
    uid: String(uid),
  });
  const byCat = await q(
    sequelize,
    `SELECT category, COALESCE(SUM(profit),0)+COALESCE(SUM(loss),0) AS net FROM ${LEDGER} WHERE user_id = :uid AND ${PL_WHERE} GROUP BY category`,
    { uid: String(uid) }
  );
  const sp = num(pl?.p);
  const sl = num(pl?.l);
  const storedProfit = counters ? num(counters.profit) : sp + sl;
  const storedWin = counters ? num(counters.net_win) : sp;
  const storedLoss = counters ? num(counters.net_loss) : sl;
  const agree = (stored, ledger, name) => (Math.abs(stored - ledger) <= 0.01 ? 'stored counter agrees' : `stored ${name} reads ${r2(stored)}`);
  const plRules = [
    {
      label: 'Actual P/L (from ledger — total win + total loss)',
      expected: r2(sp + sl),
      actual: r2(sp + sl),
      diff: 0,
      pass: true,
      info: true,
      note: agree(storedProfit, sp + sl, 'profit'),
      subs: byCat.map((c) => ({ label: `${c.category} settled P/L`, actual: r2(c.net), pass: true })),
    },
    { label: 'Total win (from ledger)', expected: r2(sp), actual: r2(sp), diff: 0, pass: true, info: true, note: agree(storedWin, sp, 'net_win') },
    { label: 'Total loss (from ledger)', expected: r2(sl), actual: r2(sl), diff: 0, pass: true, info: true, note: agree(storedLoss, sl, 'net_loss') },
  ];
  Object.assign(snapshot, {
    actual_pl: r2(sp + sl),
    total_win: r2(sp),
    total_loss: r2(sl),
    profit_loss: r2(storedProfit),
    net_win: r2(storedWin),
    net_loss: r2(storedLoss),
    counters_lag: Math.abs(storedProfit - (sp + sl)) > 0.01 || Math.abs(storedWin - sp) > 0.01 || Math.abs(storedLoss - sl) > 0.01,
  });
  categories.push({ key: 'pnl', label: 'Profit & Loss', icon: 'pnl', rules: plRules, pass: catVerdict(plRules) });

  const perMarket = await q(
    sequelize,
    `SELECT market, game_type, ROUND(SUM(grp)::numeric,2) AS worst FROM (
        SELECT COALESCE(match_title, match_id) AS market, game_type, LEAST(0, MIN(exposure_amount)) AS grp
          FROM ${EXPOSURE}
         WHERE user_id = :uid AND category <> 'casino' AND game_type IS NOT NULL
           AND game_type NOT IN ${FANCY_GT} AND game_type NOT LIKE '%Overs Line%' AND ${NOT_BACKLAY}
         GROUP BY 1, 2, match_id, event_id
        UNION ALL
        SELECT COALESCE(match_title, match_id), game_type, LEAST(exposure_amount, 0)
          FROM ${EXPOSURE}
         WHERE user_id = :uid AND (category='casino' OR game_type IS NULL OR game_type IN ${FANCY_GT} OR game_type LIKE '%Overs Line%') AND ${NOT_BACKLAY}
     ) s GROUP BY market, game_type ORDER BY worst ASC`,
    { uid }
  );
  const expRules = [
    chk('Net exposure equals the re-derived worst-case', derived, storedExp, {
      subs: perMarket.map((m) => ({ label: `${m.market} (${m.game_type || '—'})`, actual: r2(m.worst), pass: true })),
    }),
  ];
  categories.push({ key: 'exposure', label: 'Exposure', icon: 'exposure', rules: expRules, pass: catVerdict(expRules) });

  if (account.wallet_id) categories.push(await pointLedgerCategory(sequelize, account.wallet_id));
  categories.push(await hierarchyCategory(sequelize, account, await buildUpline(sequelize, account)));
  categories.push(await sportsCategory(sequelize, uid));

  return { found: true, snapshot, categories, allPass: categories.every((c) => c.pass) };
}

async function buildAgentReport(sequelize, account) {
  const [w] = await q(sequelize, 'SELECT inr, credit_limit FROM public.credits WHERE staff_id = :id LIMIT 1', { id: account.id });
  const balance = num(w?.inr);
  const snapshot = {
    kind: account.kind,
    user_id: account.id,
    username: account.username,
    role: account.role,
    total_balance: r2(balance),
    available_balance: r2(balance + num(w?.credit_limit)),
    locked_exposure: 0,
    actual_pl: null,
  };

  const categories = [];
  const walletRules = w
    ? [
        chk('Balance never goes below the credit line', Math.max(balance, -num(w.credit_limit)), balance, {
          note: `credit line ${r2(w.credit_limit)}`,
        }),
      ]
    : [{ label: 'A wallet record exists for this account', expected: 1, actual: 0, diff: -1, pass: false }];
  categories.push({ key: 'wallet', label: 'Wallet Integrity', icon: 'wallet', rules: walletRules, pass: catVerdict(walletRules) });

  if (account.wallet_id) categories.push(await pointLedgerCategory(sequelize, account.wallet_id));
  categories.push(await hierarchyCategory(sequelize, account, await buildUpline(sequelize, account)));
  categories.push({
    key: 'betting',
    label: 'Betting',
    icon: 'betting',
    pass: true,
    rules: [
      {
        label: `${account.kind === 'owner' ? 'Owner' : 'Agent'} account — per-bet settlement checks do not apply (this account does not place bets)`,
        expected: 0,
        actual: 0,
        diff: 0,
        pass: true,
        info: true,
      },
    ],
  });

  return { found: true, snapshot, categories, allPass: categories.every((c) => c.pass) };
}

async function buildAccountReport(sequelize, idOrUsername) {
  const account = await resolveAccount(sequelize, idOrUsername);
  if (!account) return { found: false, error: 'Account not found' };
  return account.kind === 'user' ? buildBettorReport(sequelize, account) : buildAgentReport(sequelize, account);
}

module.exports = { searchAccounts, buildAccountReport, resolveAccount, buildUpline };

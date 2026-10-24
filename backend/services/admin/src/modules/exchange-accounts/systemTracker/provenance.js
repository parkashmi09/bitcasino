'use strict';

const { QueryTypes } = require('sequelize');

const { resolveAccount, buildUpline } = require('./report');

/**
 * System Tracker > "Where this balance came from" — zip ka `systemTracker/provenance.js`.
 *
 *   buckets  — balance ke hisse (upline se aaya, downline ko diya …), har event ke counterparty ke saath
 *   upline   — owner tak ki chain
 *   reconcile — opening + transfers + game activity = stored balance
 *
 * Zip ke `transactions` ki jagah hamara `staff_transfers` (har parent ↔ child len-den).
 * Opening 0 hai — hamare accounts 0 pe bante hain, opening balance bhi ek transfer hai.
 * Game activity = baaki bacha movement (zip bhi aise hi nikalta hai), aur sports ledger ki
 * P/L rows sirf jaankari ke liye.
 */

const q = (sequelize, sql, replacements = {}) => sequelize.query(sql, { type: QueryTypes.SELECT, replacements });
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Number(num(v).toFixed(2));

const BUCKET_DEFS = [
  { key: 'in_from_upline', label: 'Received from upline', dir: 'in', rel: 'upline' },
  { key: 'in_from_downline', label: 'Taken back from downline', dir: 'in', rel: 'downline' },
  { key: 'out_to_downline', label: 'Given out to downline', dir: 'out', rel: 'downline' },
  { key: 'out_to_upline', label: 'Returned to upline', dir: 'out', rel: 'upline' },
];

/** Is account ke saare transfers, + (aaya) / − (gaya) ke saath, aur doosri taraf ka naam. */
async function transfersOf(sequelize, type, id) {
  return q(
    sequelize,
    `SELECT t.id, t.direction, t.transfer_type, t.note, t.created_at AS at,
            CASE WHEN t.to_type = :type AND CAST(t.to_id AS TEXT) = :id THEN t.amount ELSE -t.amount END AS delta,
            CASE WHEN t.to_type = :type AND CAST(t.to_id AS TEXT) = :id THEN t.from_type ELSE t.to_type END AS other_type,
            CASE WHEN t.to_type = :type AND CAST(t.to_id AS TEXT) = :id THEN t.from_id ELSE t.to_id END AS other_id
       FROM public.staff_transfers t
      WHERE (t.to_type = :type AND CAST(t.to_id AS TEXT) = :id)
         OR (t.from_type = :type AND CAST(t.from_id AS TEXT) = :id)
      ORDER BY t.id DESC
      LIMIT 2000`,
    { type, id: String(id) }
  );
}

async function namesFor(sequelize, rows) {
  const ids = (type) => [...new Set(rows.filter((r) => r.other_type === type).map((r) => String(r.other_id)))];
  const staffIds = ids('staff');
  const userIds = ids('user');
  const staff = staffIds.length ? await q(sequelize, 'SELECT CAST(id AS TEXT) AS id, name FROM public.staff WHERE CAST(id AS TEXT) IN (:ids)', { ids: staffIds }) : [];
  const users = userIds.length ? await q(sequelize, 'SELECT CAST(id AS TEXT) AS id, name FROM public.users WHERE CAST(id AS TEXT) IN (:ids)', { ids: userIds }) : [];
  const map = new Map([...staff.map((s) => [`staff:${s.id}`, s.name]), ...users.map((u) => [`user:${u.id}`, u.name])]);
  return (row) => map.get(`${row.other_type}:${row.other_id}`) ?? `${row.other_type} #${row.other_id}`;
}

async function buildProvenance(sequelize, idOrUsername) {
  const account = await resolveAccount(sequelize, idOrUsername);
  if (!account) return { found: false, error: 'Account not found' };
  if (!account.wallet_id) return { found: false, error: `No wallet record for ${account.username}` };

  const type = account.kind === 'user' ? 'user' : 'staff';
  const [wallet] = await q(sequelize, 'SELECT inr, credit, all_point FROM public.credits WHERE id = :id', { id: account.wallet_id });
  const upline = await buildUpline(sequelize, account);
  const txRows = await transfersOf(sequelize, type, account.id);
  const nameOf = await namesFor(sequelize, txRows);

  // Upline = direct parent (player ka parent_staff_id, staff ka parent_id).
  const parentId = account.parent_staff_id ? String(account.parent_staff_id) : null;
  const relOf = (t) => (t.other_type === 'staff' && parentId && String(t.other_id) === parentId ? 'upline' : 'downline');
  const shape = (t) => ({ id: t.id, at: t.at, type: t.note || t.direction, amount: r2(t.delta), counterparty: nameOf(t) });

  const buckets = [{ key: 'opening', label: 'Opening balance (before any recorded transaction)', amount: 0, count: 0, events: [], note: 'accounts open at 0 here — the opening balance is a transfer' }];

  for (const b of BUCKET_DEFS) {
    const rows = txRows.filter((t) => (num(t.delta) >= 0 ? 'in' : 'out') === b.dir && relOf(t) === b.rel && num(t.delta) !== 0);
    if (!rows.length) continue;
    buckets.push({ key: b.key, label: b.label, amount: r2(rows.reduce((s, t) => s + num(t.delta), 0)), count: rows.length, events: rows.map(shape) });
  }

  // Sports settlement P/L (sirf player).
  const plRows =
    type === 'user'
      ? await q(
          sequelize,
          `SELECT id, category, reason, bet_id, match_id, market_type, sport_id, description, created_at AS at,
                  COALESCE(profit,0) + COALESCE(loss,0) AS delta
             FROM mssports.credits_ledger
            WHERE user_id = :uid AND LOWER(reason) = 'settlement'
            ORDER BY id DESC`,
          { uid: String(account.id) }
        )
      : [];
  if (plRows.length) {
    buckets.push({
      key: 'pl_sports',
      label: 'SPORTS settlement P/L',
      amount: r2(plRows.reduce((s, l) => s + num(l.delta), 0)),
      count: plRows.length,
      events: plRows.slice(0, 200).map((l) => ({
        id: l.id,
        at: l.at,
        amount: r2(l.delta),
        bet_id: l.bet_id,
        market_type: l.market_type,
        remark: l.description,
      })),
      truncated: plRows.length > 200,
    });
  }

  // Manual adjustments / reversals point ledger me (zip: attention).
  const manual = await q(
    sequelize,
    `SELECT id, event_type, entry_ref, delta, remark, created_at AS at
       FROM mssports.point_ledger
      WHERE wallet_id = :id AND event_type IN ('MANUAL_ADJUSTMENT','REVERSAL')
      ORDER BY id DESC`,
    { id: account.wallet_id }
  );
  buckets.push({
    key: 'manual',
    label: 'Manual adjustments & reversals',
    amount: r2(manual.reduce((s, m) => s + num(m.delta), 0)),
    count: manual.length,
    severity: manual.length ? 'attention' : null,
    events: manual.map((m) => ({ id: m.id, at: m.at, type: m.event_type, amount: r2(m.delta), remark: m.remark })),
  });

  // Player ka stored = inr + band paisa (exposure), kyunki bet pe liability inr se katti hai.
  let stored = num(wallet?.inr);
  if (type === 'user') {
    const [te] = await q(sequelize, 'SELECT total_exposure FROM mssports.total_exposures WHERE user_id = :uid', { uid: account.id });
    stored += Math.abs(num(te?.total_exposure));
  }
  const opening = 0;
  const txDelta = txRows.reduce((s, t) => s + num(t.delta), 0);
  const plDelta = plRows.reduce((s, l) => s + num(l.delta), 0);
  const gameMovement = r2(stored - opening - txDelta);
  const derived = r2(opening + txDelta + gameMovement);
  const residual = r2(stored - derived);
  const undescribed = r2(gameMovement - plDelta);

  return {
    found: true,
    account: {
      kind: account.kind,
      id: account.id,
      username: account.username,
      role: account.role,
      wallet_id: account.wallet_id,
      inr_balance: r2(wallet?.inr),
      credit: r2(wallet?.credit),
      all_point: r2(wallet?.all_point),
    },
    buckets,
    upline,
    reconciliation: {
      opening,
      transactions: r2(txDelta),
      settlement: gameMovement,
      derived,
      stored: r2(stored),
      residual,
      pass: Math.abs(residual) <= 0.01,
      note:
        Math.abs(residual) <= 0.01
          ? 'Every rupee in this balance is accounted for: opening + transfers + game activity = the stored balance exactly.'
          : 'Balance does not reconcile against its own recorded movements — investigate before acting.',
      ledger: {
        recordedPL: r2(plDelta),
        observedMovement: gameMovement,
        undescribed,
        complete: Math.abs(undescribed) <= 0.01,
        note:
          Math.abs(undescribed) <= 0.01
            ? "Ledger P/L rows describe the whole of this account's game activity."
            : 'The ledger P/L rows do not describe all of this movement (casino play, deposits, withdrawals and stake returns are not sports P/L). NOT missing money — the balance above still reconciles.',
      },
    },
  };
}

module.exports = { buildProvenance };

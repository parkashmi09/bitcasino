'use strict';

const { QueryTypes } = require('sequelize');
const { STAFF_LEVELS } = require('@ibitplay/auth');

const { findClient, playersFor, playersUnder } = require('./reportScope');
const { sportName } = require('./sportsNet');

/**
 * Zip ke P/L reports — sab login wale ke tree tak simit. Casino / third party
 * ke columns yahan nahi (is project me casino exchange nahi hai).
 *
 *   partyWinLoss     — GET  /admin/profitloss/all            (Party Win Loss)
 *   userWinLoss      — POST /admin/reports/point-category-report (User Win Loss)
 *   totalProfitLoss  — POST /admin/reports/total-profit-loss  (Total Profit Loss)
 *   turnover         — POST /admin/reports/turnover           (Turn Over)
 */

const round2 = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const ids = (list) => (list.length ? list : ['0']);

/** Date range — toDate ka poora din shaamil. */
const dateSql = (t = '') => `${t}created_at >= CAST(:fromDate AS date) AND ${t}created_at < CAST(:toDate AS date) + 1`;

// ════════════════════════════════════════════════════════════════════════
//  Party Win Loss
// ════════════════════════════════════════════════════════════════════════

/**
 * Hierarchy ke sab players ka game P/L (point_ledger ka SUM): sports (bet wali entries),
 * casino (category CASINO, third-party) aur original games (ORIGINAL_GAME); P/L = teeno ka jod.
 * Upar mera + mere staff ki rows (points 0 — staff ka number players ka hi jod hai,
 * dobara ginte to total double ho jata), phir players profit ke hisaab se.
 * type = 'user' → sirf players.
 */
async function partyWinLoss(sequelize, tree, { type, search }) {
  const staffRows = await sequelize.query(
    `SELECT s.id, s.name AS username, r.name AS level, r.level AS role_level
       FROM staff s JOIN roles r ON r.id = s.role_id
      WHERE s.id IN (:staffIds) AND r.level < :executiveLevel
      ORDER BY r.level, LOWER(s.name)`,
    { replacements: { staffIds: ids(tree.staffIds), executiveLevel: STAFF_LEVELS.EXECUTIVE }, type: QueryTypes.SELECT }
  );

  const players = await playersUnder(sequelize, tree.staffIds, tree.withDirectUsers);
  const userRows = players.length
    ? await sequelize.query(
      `SELECT u.id, u.name AS username,
              COALESCE(SUM(p.delta) FILTER (WHERE p.bet_id IS NOT NULL AND COALESCE(p.category, 'SPORTS') = 'SPORTS'), 0) AS sport,
              COALESCE(SUM(p.delta) FILTER (WHERE p.category = 'CASINO'), 0) AS casino,
              COALESCE(SUM(p.delta) FILTER (WHERE p.category = 'ORIGINAL_GAME'), 0) AS original
         FROM users u LEFT JOIN credits c ON c.uid = u.id
         LEFT JOIN mssports.point_ledger p ON p.wallet_id = c.id
        WHERE u.id IN (:players)
        GROUP BY u.id, u.name`,
      { replacements: { players }, type: QueryTypes.SELECT }
    )
    : [];

  const zero = { sport_pts: 0, casino_pts: 0, original_pts: 0, profit_loss: 0, ptype: 'Point' };
  const staff = staffRows.map((s) => ({ key: `staff-${s.id}`, username: s.username, level: s.level, ...zero }));
  const users = userRows
    .map((u) => ({
      key: `user-${u.id}`,
      username: u.username,
      level: 'User',
      sport_pts: round2(u.sport),
      casino_pts: round2(u.casino),
      original_pts: round2(u.original),
      profit_loss: round2(round2(u.sport) + round2(u.casino) + round2(u.original)),
      ptype: 'Point',
    }))
    .sort((a, b) => b.profit_loss - a.profit_loss);

  let rows = type === 'user' ? users : [...staff, ...users];
  if (search) rows = rows.filter((r) => String(r.username || '').toLowerCase().includes(search.toLowerCase()));
  return rows;
}

// ════════════════════════════════════════════════════════════════════════
//  User Win Loss (point category report)
// ════════════════════════════════════════════════════════════════════════

/** point_ledger.category → report column (zip POINT_CATEGORY_FIELD; sportbook hamare yahan nahi). */
const POINT_CATEGORY_FIELD = { SPORTS: 'sports_pts', CASINO: 'casino_pts', ORIGINAL_GAME: 'original_pts' };

/**
 * Har player ka category-wise SUM(delta) — range ke andar. delta signed hai
 * (jeet +, haar −), isliye SUM hi net hai. Sirf wahi players jinki entry hai.
 */
async function userWinLoss(sequelize, tree, f) {
  const client = await findClient(sequelize, tree, f);
  const players = await playersFor(sequelize, tree, client);
  if (!players.length) return { rows: [], totals: emptyTotals() };

  const sums = await sequelize.query(
    `SELECT u.id, u.name AS username, p.category, SUM(p.delta) AS total
       FROM mssports.point_ledger p
       JOIN credits c ON c.id = p.wallet_id
       JOIN users u ON u.id = c.uid
      WHERE u.id IN (:players) AND p.category IN (:categories)
        AND ${dateSql('p.')}
      GROUP BY u.id, u.name, p.category`,
    {
      replacements: { players, categories: Object.keys(POINT_CATEGORY_FIELD), fromDate: f.fromDate, toDate: f.toDate },
      type: QueryTypes.SELECT,
    }
  );

  const perUser = {};
  const totals = emptyTotals();
  for (const s of sums) {
    const field = POINT_CATEGORY_FIELD[s.category];
    const amount = round2(s.total);
    perUser[s.id] ??= { user_id: String(s.id), username: s.username, ...emptyTotals() };
    perUser[s.id][field] = round2(perUser[s.id][field] + amount);
    perUser[s.id].total = round2(perUser[s.id].total + amount);
    totals[field] = round2(totals[field] + amount);
    totals.total = round2(totals.total + amount);
  }

  return { rows: Object.values(perUser).sort((a, b) => b.total - a.total), totals };
}

// ════════════════════════════════════════════════════════════════════════
//  User Win Loss — Direct Users tab (direct users ki point entry nahi banti)
// ════════════════════════════════════════════════════════════════════════

/** Settled bet: in result_status wali bets ka P/L hota hai (void / refund / cancelled nahi). */
const SETTLED_RESULTS = ['won', 'win', 'loss', 'lost'];
/**
 * mssports.credits_ledger ke settlement reasons. Har row ka `profit + loss` (loss negative) P/L hai —
 * settlement ledger ka "Total P/L". netamount nahi: MO / BM ek market ke back aur lay ek hi row me
 * (pehli bet pe) settle hote hain, exposure lautake + P/L, to per-bet stake − netamount jeeti lay ko haar ginta tha.
 */
const LEDGER_REASONS = ['settlement', 'settlement_void', 'commission', 'commission_void'];

/**
 * Direct users ka P/L: har settled bet (window = settle time, `updated_at`) se judi ledger rows
 * (settlement + settlement_void + commission + commission_void) ka Σ(profit + loss).
 * Wahi row shape jo userWinLoss deta hai; `sports_pts` yahan INR hai (1 pt = 1 INR).
 * Sirf owner (tree.withDirectUsers) ko dikhta hai; baaki ko khaali.
 */
async function directUserWinLoss(sequelize, tree, f) {
  if (!tree.withDirectUsers) return { rows: [], totals: emptyTotals() };
  const client = await findClient(sequelize, tree, f);
  const players = await playersFor(sequelize, tree, client);
  if (!players.length) return { rows: [], totals: emptyTotals() };

  const sums = await sequelize.query(
    `SELECT u.id, u.name AS username,
            SUM(COALESCE((SELECT SUM(COALESCE(l.profit, 0) + COALESCE(l.loss, 0)) FROM mssports.credits_ledger l
                           WHERE l.bet_id = b.id AND l.reason IN (:reasons)), 0)) AS total
       FROM mssports."SportsBet" b
       JOIN users u ON u.id = b.user_id
      WHERE b.user_id IN (:players) AND u.parent_staff_id IS NULL
        AND LOWER(COALESCE(b.result_status, '')) IN (:settled)
        AND b.updated_at >= CAST(:fromDate AS date) AND b.updated_at < CAST(:toDate AS date) + 1
      GROUP BY u.id, u.name`,
    {
      replacements: { players, reasons: LEDGER_REASONS, settled: SETTLED_RESULTS, fromDate: f.fromDate, toDate: f.toDate },
      type: QueryTypes.SELECT,
    }
  );

  const totals = emptyTotals();
  const rows = sums
    .map((s) => {
      const amount = round2(s.total);
      totals.sports_pts = round2(totals.sports_pts + amount);
      totals.total = round2(totals.total + amount);
      return { user_id: String(s.id), username: s.username, ...emptyTotals(), sports_pts: amount, total: amount };
    })
    .sort((a, b) => b.total - a.total);
  return { rows, totals };
}

function emptyTotals() {
  return { sports_pts: 0, casino_pts: 0, original_pts: 0, total: 0 };
}

// ════════════════════════════════════════════════════════════════════════
//  Total Profit Loss
// ════════════════════════════════════════════════════════════════════════

/**
 * Sports ledger (mssports.credits_ledger) ka jod — sport naam + game type (bet ka gtype) ke hisaab se.
 *   Opening = kul loss,  Closing = kul profit,  Profit/Loss = profit − loss
 */
async function totalProfitLoss(sequelize, tree, f) {
  const client = await findClient(sequelize, tree, f);
  const players = await playersFor(sequelize, tree, client);
  if (!players.length) return { sports: [] };

  const ledger = await sequelize.query(
    `SELECT l.sport_id, b.gtype, l.profit, l.loss
       FROM mssports.credits_ledger l
       LEFT JOIN mssports."SportsBet" b ON b.id = l.bet_id
      WHERE l.user_id IN (:players) AND COALESCE(l.category, 'SPORTS') = 'SPORTS'
        AND ${dateSql('l.')}`,
    { replacements: { players, fromDate: f.fromDate, toDate: f.toDate }, type: QueryTypes.SELECT }
  );

  const groups = {};
  for (const r of ledger) {
    const name = sportName(r.sport_id) || 'Other';
    const gtype = r.gtype || 'Other';
    const key = `${name}__${gtype}`;
    groups[key] ??= { event_name: name, game_type: gtype, profit: 0, loss: 0 };
    groups[key].profit += parseFloat(r.profit) || 0;
    groups[key].loss += Math.abs(parseFloat(r.loss) || 0);
  }

  const sports = Object.values(groups).map((g) => ({
    event_name: g.event_name,
    game_type: g.game_type,
    opening: round2(g.loss),
    closing: round2(g.profit),
    profit_loss: round2(g.profit - g.loss),
  }));
  return { sports };
}

// ════════════════════════════════════════════════════════════════════════
//  Turn Over
// ════════════════════════════════════════════════════════════════════════

/**
 * Sports bets ka turnover — range, sport aur game type ke hisaab se.
 *   Win / Loss          = un bets ki ledger entries ka profit / |loss| jod
 *   Win/Loss Turn Over  = jeeti / haari bets ki liability ka jod
 */
async function turnover(sequelize, tree, f) {
  const client = await findClient(sequelize, tree, f);
  const players = await playersFor(sequelize, tree, client);
  const zero = { loss_turnover: 0, loss: 0, win_turnover: 0, win: 0, total_turnover: 0, total_pl: 0 };
  if (!players.length) return zero;

  const bets = await sequelize.query(
    `SELECT id, result_status, liability FROM mssports."SportsBet"
      WHERE user_id IN (:players) AND sport_id = :sportId AND ${dateSql()}
        ${f.gtype ? 'AND LOWER(gtype) = LOWER(:gtype)' : ''}`,
    {
      replacements: { players, sportId: String(f.sportId), gtype: f.gtype || null, fromDate: f.fromDate, toDate: f.toDate },
      type: QueryTypes.SELECT,
    }
  );
  if (!bets.length) return zero;

  let winTurnover = 0;
  let lossTurnover = 0;
  for (const bet of bets) {
    if (bet.result_status === 'won') winTurnover += Math.abs(parseFloat(bet.liability) || 0);
    else if (bet.result_status === 'loss') lossTurnover += Math.abs(parseFloat(bet.liability) || 0);
  }

  const [sum] = await sequelize.query(
    `SELECT COALESCE(SUM(profit), 0) AS win, COALESCE(SUM(loss), 0) AS loss
       FROM mssports.credits_ledger
      WHERE bet_id IN (:betIds) AND category = 'SPORTS'`,
    { replacements: { betIds: bets.map((b) => b.id) }, type: QueryTypes.SELECT }
  );
  const win = parseFloat(sum.win) || 0;
  const loss = Math.abs(parseFloat(sum.loss) || 0);

  return {
    loss_turnover: round2(lossTurnover),
    loss: round2(loss),
    win_turnover: round2(winTurnover),
    win: round2(win),
    total_turnover: round2(winTurnover + lossTurnover),
    total_pl: round2(win - loss),
  };
}

module.exports = { partyWinLoss, userWinLoss, directUserWinLoss, totalProfitLoss, turnover };

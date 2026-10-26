'use strict';

const { QueryTypes } = require('sequelize');
const { AppError } = require('@ibitplay/common');

const { findClient } = require('./reportScope');
const { sportName } = require('./sportsNet');

/**
 * Direct user ki bet history — `mssports.point_ledger_direct` se (migration 116).
 *
 * Agent user ka hisaab `mssports.point_ledger` me hai (Account Statement, accountStatement.js).
 * Direct user (parent_staff_id NULL) ki koi chain nahi, isliye uski har entry ek hi row hai, uski
 * apni currency me:
 *   SPORTS  BET_SETTLEMENT (settle:bet:SPORTS:<betId>), uska void REVERSAL, settle se pehle VOID
 *   CASINO  JS games / GIS ka har paisa hilane wala callback
 * `delta` signed (jeet +, haar / stake −), `balance_after` = us currency me wallet ka balance.
 *
 * Har ledger row ek line; SPORTS row ke saath us bet ki details (mssports."SportsBet").
 * Market ke saare bets: `POST /statement/bet-detail` { betId, category: 'SPORTS' } (direct pe bhi chalta hai).
 * Player ka apna statement (market wise joda hua) sports-service ka `POST /user/account-statement-direct` hai.
 */

const notDirect = () => new AppError('This report is for direct users only', 400, 'EXCHANGE_NOT_DIRECT_USER');

const round2 = (n) => Math.round(n * 100) / 100;
const isVoidRow = (r) => r.event_type === 'REVERSAL' || r.event_type === 'VOID' || String(r.entry_ref || '').startsWith('reverse:');

/** One `point_ledger_direct` row (+ its SportsBet columns) as the statement prints it. Branch statements share it. */
function ledgerRow(r) {
  const delta = round2(Number(r.delta || 0));
  const sports = r.category === 'SPORTS';
  const sportId = r.bet_sport_id ?? r.sport_id ?? null;
  return {
    id: String(r.id),
    date: r.created_at,
    category: r.category,
    eventType: r.event_type,
    void: isVoidRow(r),
    currency: r.currency,
    amount: delta.toFixed(2),
    credit: delta > 0 ? delta.toFixed(2) : '-',
    debit: delta < 0 ? Math.abs(delta).toFixed(2) : '-',
    closing: r.balance_after != null ? round2(Number(r.balance_after)).toFixed(2) : '-',
    description: String(r.remark || r.event_type || '').split('#')[0],
    gameType: r.game_type ?? null,
    betId: r.bet_id != null ? String(r.bet_id) : null,
    bet: sports && r.bet_row_id != null
      ? {
          sport: sportName(sportId) || (sportId ? `Sport ${sportId}` : null),
          event: r.match_title || r.event_name || null,
          market: r.market_type || null,
          selection: r.fancy_name || r.selection_name || null,
          side: r.bet_type || null,
          odds: r.odds != null ? String(r.odds) : null,
          stake: r.stake_amount != null ? String(r.stake_amount) : null,
          liability: r.liability != null ? String(r.liability) : null,
          status: r.bet_status || null,
          result: r.result_status || null,
          eventId: r.eventid || null,
          matchId: r.match_id || null,
        }
      : null,
  };
}

async function directBetHistory(sequelize, tree, f) {
  // Sirf direct users ka tree (treeOf 'direct'): koi staff ka player yahan nahi khulta.
  const client = await findClient(sequelize, tree, { clientType: 'user', clientId: f.clientId });
  const [user] = await sequelize.query('SELECT parent_staff_id FROM users WHERE id = :id', {
    replacements: { id: client.id },
    type: QueryTypes.SELECT,
  });
  if (user?.parent_staff_id != null) throw notDirect();

  const where = ['l.user_id = :userId', 'l.created_at >= CAST(:fromDate AS date)', 'l.created_at < CAST(:toDate AS date) + 1'];
  const replacements = { userId: client.id, fromDate: f.fromDate, toDate: f.toDate };
  if (f.category !== 'ALL') {
    where.push('l.category = :category');
    replacements.category = f.category;
  }
  if (f.currency) {
    where.push('l.currency = :currency');
    replacements.currency = f.currency;
  }
  const sql = where.join(' AND ');

  const [{ count }] = await sequelize.query(`SELECT COUNT(*)::int AS count FROM mssports.point_ledger_direct l WHERE ${sql}`, {
    replacements,
    type: QueryTypes.SELECT,
  });

  const rows = await sequelize.query(
    `SELECT l.id, l.entry_ref, l.event_type, l.category, l.currency, l.delta, l.balance_after,
            l.bet_id, l.sport_id, l.game_type, l.remark, l.created_at,
            b.match_title, b.event_name, b.market_type, b.selection_name, b.fancy_name, b.bet_type,
            b.odds, b.stake_amount, b.liability, b.status AS bet_status, b.result_status,
            b.id AS bet_row_id, b.eventid, b.match_id, b.sport_id AS bet_sport_id
       FROM mssports.point_ledger_direct l
       LEFT JOIN mssports."SportsBet" b ON l.category = 'SPORTS' AND b.id = l.bet_id
      WHERE ${sql}
      ORDER BY l.id DESC
      LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: f.limit, offset: (f.page - 1) * f.limit }, type: QueryTypes.SELECT }
  );

  const data = rows.map(ledgerRow);

  return {
    user: { id: client.id, name: client.name },
    rows: data,
    total: count,
    page: f.page,
    totalPages: Math.max(1, Math.ceil(count / f.limit)),
  };
}

module.exports = { directBetHistory, ledgerRow };

'use strict';

const { QueryTypes } = require('sequelize');

const { findClient, playersUnder, walletIdOf, notInTree } = require('./reportScope');
const { sportName, sportsNet, loadFanSettlementNet, fanMarketName, isKhadoBet } = require('./sportsNet');

/**
 * Account Statement — zip ka `POST /admin/reports/statementv2` (TransactionReportService.getStatementV2)
 * aur game row ke peeche ke bets (`statementv2/bet-detail`, `statementv2/bet-export`).
 *
 * Sab kuch `mssports.point_ledger` se:
 *   Deposit/Withdraw Report (TRANSACTION) → bet_id NULL (Credit / Debit / Bank Deposite / Bank Withdraw)
 *   Game Report (SPORTS)                   → bet_id wali entries (BET_SETTLEMENT, COMMISSION, REVERSAL)
 */

const EVENT = {
  CREDIT: 'Credit',
  DEBIT: 'Debit',
  USER_CREATION: 'User creation',
  BANK_DEPOSIT: 'Bank Deposite',
  BANK_WITHDRAW: 'Bank Withdraw',
  REVERSAL: 'REVERSAL',
};

/**
 * "Statement" dropdown (Deposit/Withdraw Report) → kaun se events, aur kis taraf ki entries:
 *   any    = meri wallet ki ya jo maine settle ki (wallet_id ya settled_with_wallet_id)
 *   own    = upar se mujhe jo mila (sirf wallet_id)
 *   parent = jo maine neeche walon ke saath kiya (settled_with_wallet_id)
 */
const STATEMENT_FILTERS = {
  allcredit: { events: [EVENT.CREDIT, EVENT.DEBIT, EVENT.USER_CREATION], side: 'any' },
  creditupper: { events: [EVENT.CREDIT, EVENT.USER_CREATION], side: 'own' },
  creditdown: { events: [EVENT.CREDIT, EVENT.DEBIT], side: 'parent' },
  allbalance: { events: [EVENT.BANK_DEPOSIT, EVENT.BANK_WITHDRAW], side: 'any' },
  balanceupper: { events: [EVENT.BANK_DEPOSIT, EVENT.BANK_WITHDRAW], side: 'own' },
  balancedown: { events: [EVENT.BANK_DEPOSIT, EVENT.BANK_WITHDRAW], side: 'parent' },
};

const SIDE_SQL = {
  any: '(wallet_id = :walletId OR settled_with_wallet_id = :walletId)',
  own: 'wallet_id = :walletId',
  parent: 'settled_with_wallet_id = :walletId',
};

const round2 = (n) => Math.round(n * 100) / 100;

// Void ki ulti entry "… -void" padhi jaaye (zip helper/voidLabel.js).
const isVoidRow = (r) => r.event_type === EVENT.REVERSAL || String(r.entry_ref || '').startsWith('reverse:');
const withVoidSuffix = (text) => {
  const s = String(text || '').replace(/^VOID after settlement\s*[—-]\s*/i, '').trim();
  if (!s) return '-void';
  return s.endsWith('-void') ? s : `${s} -void`;
};

/** WHERE clause + replacements — filters ke hisaab se. */
function buildWhere(walletId, f) {
  const parts = ['created_at >= CAST(:fromDate AS date)', 'created_at < CAST(:toDate AS date) + 1'];
  const replacements = { walletId, fromDate: f.fromDate, toDate: f.toDate };

  if (f.reportType === 'TRANSACTION') {
    parts.push('bet_id IS NULL');
    const filter = STATEMENT_FILTERS[f.statement];
    parts.push(SIDE_SQL[filter ? filter.side : 'any']);
    if (filter) {
      parts.push('event_type IN (:events)');
      replacements.events = filter.events;
    }
  } else {
    parts.push('bet_id IS NOT NULL', SIDE_SQL.any);
    if (f.sportId && f.sportId !== '0') {
      parts.push('sport_id = :sportId');
      replacements.sportId = String(f.sportId);
    }
    if (f.gameType && f.gameType !== 'all') {
      parts.push('LOWER(game_type) = LOWER(:gameType)');
      replacements.gameType = f.gameType;
    }
  }
  return { sql: parts.join(' AND '), replacements };
}

/**
 * "Opening pts": fromDate se PEHLE is wallet ka aakhri balance.
 * Wallet do tarah ki rows me aata hai — apni (closing_inr_balance) aur jahan ye
 * parent hai (closing_inr_balance_parent). Jo baad ki (bada id) wahi balance.
 */
async function openingBalance(sequelize, walletId, fromDate) {
  const [own] = await sequelize.query(
    `SELECT id, closing_inr_balance AS bal FROM mssports.point_ledger
      WHERE wallet_id = :walletId AND created_at < CAST(:fromDate AS date) AND closing_inr_balance IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    { replacements: { walletId, fromDate }, type: QueryTypes.SELECT }
  );
  const [asParent] = await sequelize.query(
    `SELECT id, closing_inr_balance_parent AS bal FROM mssports.point_ledger
      WHERE settled_with_wallet_id = :walletId AND wallet_id <> :walletId
        AND created_at < CAST(:fromDate AS date) AND closing_inr_balance_parent IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    { replacements: { walletId, fromDate }, type: QueryTypes.SELECT }
  );
  if (!own && !asParent) return 0;
  if (own && (!asParent || Number(own.id) > Number(asParent.id))) return Number(own.bal) || 0;
  return Number(asParent.bal) || 0;
}

/** Deposit/Withdraw row — main parent hoon to credit/debit ulta. */
function transactionRow(r, walletId) {
  const delta = parseFloat(r.delta || 0);
  const iAmParent = Number(r.settled_with_wallet_id) === walletId && Number(r.wallet_id) !== walletId;
  const closing = iAmParent ? (r.closing_inr_balance_parent ?? r.closing_inr_balance) : r.closing_inr_balance;
  const credited = iAmParent ? delta < 0 : delta > 0;
  const [description, fromto] = String(r.remark || '').split('#');

  return {
    id: String(r.id),
    date: r.created_at,
    credit: credited ? Math.abs(delta).toFixed(2) : '-',
    debit: !credited ? Math.abs(delta).toFixed(2) : '-',
    closing: closing != null ? parseFloat(closing).toFixed(2) : '-',
    description: description || r.event_type,
    fromto: fromto || '-',
    betId: null,
    category: null,
  };
}

/**
 * Statement ki ek page.
 * Paging virtual list par hoti hai: [Opening pts, ...DB rows] — DB ka offset usi hisaab se khisakta hai.
 */
async function statement(sequelize, tree, actor, f) {
  const client = await findClient(sequelize, tree, f);
  const account = client || { type: 'staff', id: String(actor.id) };
  const walletId = await walletIdOf(sequelize, account);
  if (!walletId) return { rows: [], total: 0, totalPages: 1, page: f.page };

  // Staff/owner ki wallet par bet ki entry player ka net hai — staff ke liye ulta (player haara = staff jeeta).
  const flip = account.type === 'staff';
  const { sql, replacements } = buildWhere(walletId, f);
  const pageSize = f.limit;
  const offset = (f.page - 1) * pageSize;

  const [{ count }] = await sequelize.query(`SELECT COUNT(*)::int AS count FROM mssports.point_ledger WHERE ${sql}`, {
    replacements,
    type: QueryTypes.SELECT,
  });
  const total = count + 1; // +1 = Opening pts
  const dbOffset = Math.max(0, offset - 1);
  const dbEnd = Math.min(count, offset + pageSize - 1);

  const rows = dbEnd > dbOffset
    ? await sequelize.query(
      `SELECT * FROM mssports.point_ledger WHERE ${sql} ORDER BY id ASC LIMIT :limit OFFSET :offset`,
      { replacements: { ...replacements, limit: dbEnd - dbOffset, offset: dbOffset }, type: QueryTypes.SELECT }
    )
    : [];
  const opening = await openingBalance(sequelize, walletId, f.fromDate);

  let data;
  if (f.reportType === 'TRANSACTION') {
    data = rows.map((r) => transactionRow(r, walletId));
  } else {
    // pts = Opening + range ki shuruaat se ab tak ka game P/L (page 2+ par pichhle pages ka jod DB se).
    let closing = opening;
    if (rows.length && dbOffset > 0) {
      const [{ prev }] = await sequelize.query(
        `SELECT COALESCE(SUM(delta), 0) AS prev FROM mssports.point_ledger WHERE ${sql} AND id < :firstId`,
        { replacements: { ...replacements, firstId: rows[0].id }, type: QueryTypes.SELECT }
      );
      closing = round2(closing + (flip ? -Number(prev) : Number(prev)));
    }
    data = rows.map((r) => {
      const delta = parseFloat(r.delta || 0);
      const myAmt = flip ? -delta : delta;
      closing = round2(closing + myAmt);
      return {
        id: String(r.id),
        date: r.created_at,
        credit: myAmt > 0 ? myAmt : 0,
        debit: myAmt < 0 ? -myAmt : 0,
        closing,
        description: isVoidRow(r) ? withVoidSuffix(r.remark) : r.remark,
        fromto: '',
        // Row click / Excel icon ke liye — is row ke peeche ka bet.
        betId: r.bet_id != null ? String(r.bet_id) : null,
        category: r.category || null,
      };
    });
  }

  if (offset === 0) {
    data.unshift({
      id: 'opening',
      date: `${f.fromDate}T00:00:00`,
      credit: '-',
      debit: '-',
      closing: opening.toFixed(2),
      description: 'Opening pts',
      fromto: '',
      betId: null,
      category: null,
    });
  }

  return { rows: data, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), page: f.page };
}

// ════════════════════════════════════════════════════════════════════════
//  Game row ke peeche ke bets — Details modal + Excel icon
// ════════════════════════════════════════════════════════════════════════

const DELETED_STATES = ['refund', 'refunded', 'void', 'deleted', 'cancelled'];
const isBlank = (v) => v == null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'null';
const n2 = (v) => (v == null || v === '' ? null : round2(Number(v)));

/**
 * Statement row → us market ke saare bets (us player ke).
 * point_ledger.bet_id market ki pehli bet hai — usi se match_id + eventid (+ fancy naam) milta hai.
 */
async function rowBets(sequelize, tree, { betId }) {
  const [bet] = await sequelize.query('SELECT * FROM mssports."SportsBet" WHERE id = :betId', {
    replacements: { betId },
    type: QueryTypes.SELECT,
  });
  if (!bet) return null;

  // Bet lagane wala mere tree me hai ya nahi.
  const players = await playersUnder(sequelize, tree.staffIds, tree.withDirectUsers);
  if (!players.includes(String(bet.user_id))) throw notInTree();

  const fancy = String(bet.game_type || '').toUpperCase() === 'FAN' ? fanMarketName(bet) : null;
  const bets = await sequelize.query(
    `SELECT * FROM mssports."SportsBet"
      WHERE user_id = :userId AND match_id = :matchId AND eventid = :eventId
        ${fancy ? 'AND (fancy_name = :fancy OR selection_name = :fancy)' : ''}
      ORDER BY created_at ASC, id DESC`,
    {
      replacements: { userId: bet.user_id, matchId: bet.match_id, eventId: bet.eventid, fancy },
      type: QueryTypes.SELECT,
    }
  );

  // Winner = settlement entry ki description ka aakhri hissa ("… / India").
  const [credit] = await sequelize.query(
    `SELECT description FROM mssports.credits_ledger
      WHERE category = 'SPORTS' AND user_id = :userId AND bet_id IN (:betIds)
        AND reason NOT IN ('commission', 'commission_void')
        AND (profit IS NOT NULL OR loss IS NOT NULL)
      ORDER BY id DESC LIMIT 1`,
    { replacements: { userId: String(bet.user_id), betIds: bets.map((b) => b.id) }, type: QueryTypes.SELECT }
  );
  const parts = String(credit?.description || '').split(' / ');
  const winner = parts.length >= 2 ? parts[parts.length - 1].trim() || null : null;

  const [user] = await sequelize.query('SELECT name FROM users WHERE id = :id', {
    replacements: { id: bet.user_id },
    type: QueryTypes.SELECT,
  });
  const fanNet = await loadFanSettlementNet(sequelize, bets);

  return { first: bet, bets, winner, fanNet, username: user?.name || '' };
}

/** Ek bet ki Win (sirf settled par) aur side. */
function betOutcome(b, fanNet) {
  const bt = String(b.bet_type || '').toLowerCase();
  const side = bt === 'back' || bt === 'yes' ? 'BACK' : bt === 'lay' || bt === 'no' ? 'LAY' : null;
  const rs = String(b.result_status || '').toLowerCase();
  const deleted = DELETED_STATES.includes(rs) || DELETED_STATES.includes(String(b.status || '').toLowerCase());
  const settled = rs === 'won' || rs === 'loss';
  const win = settled ? round2(sportsNet(b, fanNet.get(String(b.id)))) : null;
  return { side, deleted, win };
}

/** Details modal — breadcrumb, Winner, Game Time aur bets (zip buildStatementBetDetail). */
async function betDetail(sequelize, tree, params) {
  const found = await rowBets(sequelize, tree, params);
  if (!found) return null;
  const { first, bets, winner, fanNet, username } = found;

  const matchTitle = first.match_title || [first.team_one, first.team_two].filter(Boolean).join(' v ');
  const crumbs = [sportName(first.sport_id) || `Sport ${first.sport_id}`, first.league_name, matchTitle, first.market_type];

  let totalBets = 0;
  let totalWin = 0;
  const rows = bets.map((b) => {
    const { side, deleted, win } = betOutcome(b, fanNet);
    if (!deleted) {
      totalBets += 1;
      totalWin += win || 0;
    }

    // Nation / Bhav — khado me "<market>-<span>", fancy1 / oddeven me bhav nahi.
    const mt = String(b.market_type || '').toLowerCase();
    const khado = isKhadoBet(b);
    let nation = [b.fancy_name, b.selection_name].find((v) => !isBlank(v)) ?? '';
    if (khado && !isBlank(b.selection_name)) nation = isBlank(b.fancy_name) ? b.selection_name : `${b.selection_name}-${b.fancy_name}`;
    let bhav = null;
    if (khado) bhav = isBlank(b.fancy_name) ? null : b.fancy_name;
    else if (mt !== 'fancy1' && mt !== 'oddeven') bhav = Number(b.size) ? n2(b.size) : null;

    return {
      id: String(b.id),
      username,
      nation,
      rate: n2(b.odds),
      bhav,
      amount: n2(b.stake_amount),
      win,
      date: b.created_at,
      ip: b.ip_address || '',
      browser: b.browser || '',
      side: mt === 'oddeven' ? 'BACK' : side, // oddeven me Odd aur Even dono back hain
      deleted,
      badlo: b.badlo === true,
    };
  });

  return {
    breadcrumb: crumbs.filter((p) => !isBlank(p) && p !== '-').join(' -> '),
    winner,
    gameTime: first.match_start_time || first.created_at,
    totalBets,
    totalWin: round2(totalWin),
    bets: rows,
  };
}

/** Excel icon — reference ka 13-column CSV (zip BET_EXPORT_COLUMNS, naam case sameet). */
const BET_EXPORT_COLUMNS = [
  'UserName', 'nation', 'userrate', 'bettype', 'amount', 'winloss', 'ismatched',
  'placedate', 'IpAddress', 'Nationjson', 'bhav', 'cname', 'userbalrate',
];

/** placedate "20/09/2026 22:12:12.553" — IST wall clock, milliseconds ke saath. */
function placeDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

const num = (v) => (v == null || v === '' ? '' : String(round2(Number(v))));

async function betExport(sequelize, tree, params) {
  const found = await rowBets(sequelize, tree, params);
  if (!found) return null;
  const { first, bets, fanNet, username } = found;

  // userbalrate zip me users.percentage tha — hamare players par ye column nahi, isliye khaali.
  const rows = bets.map((b) => {
    // FAN run-wale markets: odds = RUN line (bhav), size = rate. fancy1 / oddeven me odds hi price hai.
    const mt = String(b.market_type || '').toLowerCase();
    const runMarket = String(b.game_type || '').toUpperCase() === 'FAN' && mt !== 'fancy1' && mt !== 'oddeven';
    const { win } = betOutcome(b, fanNet);
    return [
      username,
      (!isBlank(b.fancy_name) ? b.fancy_name : b.selection_name) || '',
      num(runMarket ? Number(b.size) || 100 : b.odds),
      String(b.bet_type || '').toLowerCase(),
      num(b.stake_amount),
      win == null ? '' : num(win),
      b.unmatched ? 'False' : 'True',
      placeDate(b.created_at),
      b.ip_address || '',
      '',
      runMarket ? num(b.odds) : '',
      b.original_currency || 'INR',
      '',
    ];
  });

  const filename = `${username.replace(/[^\w.-]/g, '') || 'bets'}-${String(first.match_id || first.id).replace(/[^\w.-]/g, '')}.csv`;
  return { filename, columns: BET_EXPORT_COLUMNS, rows };
}

module.exports = { statement, betDetail, betExport, STATEMENT_FILTERS };

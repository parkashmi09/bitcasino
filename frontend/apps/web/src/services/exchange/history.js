import { exchangeRequest } from './api';
import { getStatementKind } from './site';
import { normaliseBets } from '../../utils/exchange/addaplay';

/**
 * ─── History (auth) ──────────────────────────────────────────────────────────────────────
 */

/**
 * Current Bets page — `GET /cricket/sports-bets/user?page&limit&search&betType&status`.
 * @returns {Promise<{ rows: object[] (normaliseBet shape, see positions.js), pagination: { total,
 *   page, limit, total_pages, total_stake } | null }>}
 */
export async function getSportsBets({ page = 1, limit = 20, search, betType, status } = {}) {
  const body = await exchangeRequest('/cricket/sports-bets/user', {
    params: { page, limit, search, betType, status }, auth: true,
  });
  return { rows: normaliseBets(body?.data || []), pagination: body?.pagination ?? null };
}

/**
 * Account statement — `POST /account-statement-v2` (date range ≤ 31 days, server-enforced).
 * @param {{ fromDate:string, toDate:string, page?:number, limit?:number,
 *   reportType?:'ALL'|'TRANSACTION'|'SPORTS', search?:string }} filters
 * @returns {Promise<{ rows: Array<{ date, credit:string|'-', debit:string|'-', closing:string,
 *   description, fromto, category:'SPORTS'|…|null, betId, sportId, eventId, matchId, marketType,
 *   gameType, fancyName, eventType, isOpening? }>, total:number, totalPages:number, page:number }>}
 *   credit/debit/closing are 2-dp STRINGS, '-' when empty (as the server sends them).
 */
export async function getAccountStatement({ fromDate, toDate, page = 1, limit = 25, reportType = 'ALL', search } = {}) {
  /* v2 is the AGENT-tree statement (`point_ledger`); a direct player's money is in
     `point_ledger_direct`, so v2 answered them a bare "Opening 0.00" (services/sportsStatement.js
     has the rule). The exchange is INR, so the direct statement is read in INR. */
  const direct = (await getStatementKind().catch(() => null)) === 'direct';
  const body = await exchangeRequest(direct ? '/account-statement-direct' : '/account-statement-v2', {
    method: 'POST', json: { fromDate, toDate, page, limit, reportType, search, ...(direct ? { currency: 'INR' } : {}) }, auth: true,
  });
  return {
    rows: Array.isArray(body?.data) ? body.data : [],
    total: Number(body?.total) || 0,
    totalPages: Number(body?.totalPages) || 0,
    page: Number(body?.currentPage) || page,
  };
}

/**
 * Result popup for one SPORTS statement row — `POST /account-statement-v2/bets`.
 * `fancyName` is required for FAN rows (every fancy on an event shares one match_id).
 * @returns {Promise<{ header: object|null, winner: string|null, description: string|null,
 *   settledAt: string|null, totalBets: number, totalWin: number, bets: object[] }>}
 */
export async function getStatementMarketBets({ matchId, eventId, fancyName }) {
  const body = await exchangeRequest('/account-statement-v2/bets', {
    method: 'POST', json: { matchId, eventId, fancyName }, auth: true,
  });
  return {
    header: body?.header ?? null,
    winner: body?.winner ?? null,
    description: body?.description ?? null,
    settledAt: body?.settledAt ?? null,
    totalBets: Number(body?.totalBets) || 0,
    totalWin: Number(body?.totalWin) || 0,
    bets: Array.isArray(body?.bets) ? body.bets : [],
  };
}

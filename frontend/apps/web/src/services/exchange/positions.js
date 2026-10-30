import { exchangeRequest, POLL_TIMEOUT_MS } from './api';
import { normaliseBets } from '../../utils/exchange/addaplay';
import { getAccessToken } from './site';

/**
 * ─── The player's position on a match (auth) ─────────────────────────────────────────────
 *
 * mssports reads `user_id` from the body/query on two of these routes (`matchexposures/match` and
 * `user-open-bets-grouped`) and answers 400 without it, so they get it. The backend is used as it
 * is: it takes `user_id` = the platform user id, which is the access token's `sub` (the same
 * mapping mssports' own auth does in `platformAccounts.mjs`, `user_id: Number(p.sub)`).
 */

/** The signed-in player's id from the access token's `sub`, or null when signed out. */
export function currentUserId() {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const sub = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='))).sub;
    return sub ? Number(sub) : null;
  } catch {
    return null;
  }
}

/**
 * `POST /matchexposures/match {match_id}` — every exposure row of this event (market-level and
 * event-level rows both come back; map them onto markets with utils `mapMatchExposures`).
 * @returns {Promise<Array<{ match_id:string, event_id:string, team_name:string,
 *   exposure_amount:number, game_type:string (= the feed mname, e.g. 'Bookmaker 2'),
 *   match_title:string, category:string }>>}
 */
export async function getMatchExposure(matchId, { signal } = {}) {
  const body = await exchangeRequest('/matchexposures/match', {
    method: 'POST', json: { user_id: currentUserId(), match_id: String(matchId) }, auth: true, timeout: POLL_TIMEOUT_MS, signal,
  });
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows.map((r) => ({ ...r, exposure_amount: Number(r.exposure_amount) || 0 }));
}

/**
 * `GET /cricket/user-open-bets-grouped?eventid` — open bets on one event.
 * Each row is Addaplay's `normaliseBet` shape (betMappers.js): { id, matchId (market mid), eventId,
 * matchTitle, gameType, marketType, fancyName, selection, side:'back'|'lay'|'yes'|'no', odds:number,
 * stake:number, liability:number, status, resultStatus, createdAt, isOpen, profit:null, raw }.
 * @returns {Promise<{ matched: object[], unmatched: object[] }>}
 */
export async function getOpenBets(eventId, { signal } = {}) {
  const body = await exchangeRequest('/cricket/user-open-bets-grouped', {
    params: { eventid: eventId, user_id: currentUserId() }, auth: true, timeout: POLL_TIMEOUT_MS, signal,
  });
  const d = body?.data || {};
  return { matched: normaliseBets(d.matchedBets || []), unmatched: normaliseBets(d.unmatchedBets || []) };
}

/**
 * `GET /fancy-bets` — the player's bets on one fancy runner (the Run Amount / book ladder modal).
 * `marketType` (feed mname) separates line markets that share a runner name ("Total Runs").
 * @returns {Promise<Array<{ bet_type:string, stake_amount:number, odds:number, size:number,
 *   liability:number, market_type:string, fancy_name:string, badlo:boolean }>>}
 */
export async function getFancyBets({ runner, matchId, eventId, sportId, marketType }) {
  const body = await exchangeRequest('/fancy-bets', {
    params: { runner, match_id: matchId, event_id: eventId, sport_id: sportId, market_type: marketType },
    auth: true, timeout: POLL_TIMEOUT_MS,
  });
  const rows = Array.isArray(body?.bets) ? body.bets : Array.isArray(body?.data) ? body.data : [];
  return rows.map((b) => ({
    ...b,
    stake_amount: Number(b.stake_amount) || 0,
    odds: Number(b.odds) || 0,
    size: Number(b.size) || 0,
    liability: Number(b.liability) || 0,
  }));
}

import { exchangeRequest, POLL_TIMEOUT_MS } from './api';

/**
 * ─── Bet placement (auth) ────────────────────────────────────────────────────────────────
 *
 * Build the body with `buildPlaceRequest` (utils/exchange) — it is TENEXCH's prepareBetPayload plus
 * the `server_buffer` block mssports' placeBetBuffered reads. The server holds the bet for the
 * owner's buffer seconds, re-reads the live feed and applies suspension / drift / bookie favour
 * itself, so a /place can take several seconds. Never put a timeout on it.
 *
 * @typedef {object} PlaceResult
 * @property {true}   ok
 * @property {number|null} odds          price the server booked (live re-price), null if not echoed
 * @property {number|null} stake
 * @property {number} balanceDelta       negative = money blocked; a hedge can be POSITIVE
 * @property {number|null} oldBalance
 * @property {number|null} newBalance
 * @property {number|null} totalExposure
 * @property {object} exposure           { [market mid]: { match_title, teams: { [runner]: number } } }
 * @property {boolean} duplicate         the same client_ref was already answered
 * @property {object} raw
 *
 * Rejections are ExchangeError: 400 {error, code?} (odds changed, min/max, balance…),
 * 403 {message} (bet / user / platform / sports lock), 409 {pending:true} (same client_ref still
 * being decided → poll getBetResult). `error.message` is the server's text — toast it as-is.
 */
const toPlaceResult = (b) => ({
  ok: true,
  odds: b?.odds != null ? Number(b.odds) : null,
  stake: b?.stake != null ? Number(b.stake) : null,
  balanceDelta: Number(b?.balanceDelta) || 0,
  oldBalance: b?.oldBalance != null ? Number(b.oldBalance) : null,
  newBalance: b?.newBalance != null ? Number(b.newBalance) : null,
  totalExposure: b?.totalExposure != null ? Number(b.totalExposure) : null,
  exposure: b?.exposure || {},
  duplicate: b?.duplicate === true,
  raw: b,
});

/** `POST /place` @returns {Promise<PlaceResult>} */
export async function placeBet(payload) {
  const body = await exchangeRequest('/place', { method: 'POST', json: payload, auth: true });
  return toPlaceResult(body);
}

/**
 * `POST /place-combined {bets}` — dutched racing slip, all-or-nothing (max 10 legs).
 * @returns {Promise<PlaceResult & { legs:number }>}
 */
export async function placeCombinedBet(bets) {
  const body = await exchangeRequest('/place-combined', { method: 'POST', json: { bets }, auth: true });
  return { ...toPlaceResult(body), legs: Number(body?.legs) || 0 };
}

/**
 * What happened to a bet whose answer this page never got (reload mid-buffer).
 * `GET /bet-result/:clientRef` — the server keeps an outcome for 5 minutes.
 * @returns {Promise<{ state:'pending'|'accepted'|'rejected'|'unknown', message:string|null,
 *   odds:number|null, stake:number|null }>}
 */
export async function getBetResult(clientRef) {
  const body = await exchangeRequest(`/bet-result/${encodeURIComponent(clientRef)}`, { auth: true, timeout: POLL_TIMEOUT_MS });
  return {
    state: body?.state || 'unknown',
    message: body?.message ?? null,
    odds: body?.odds != null ? Number(body.odds) : null,
    stake: body?.stake != null ? Number(body.stake) : null,
  };
}

/* ─── Bets a reload left in flight (TENEXCH utils/pendingBet.js, toasts removed) ──────────────
   Remember each client_ref before POSTing and clear it on the answer; on the next load
   `reconcilePendingBets(onOutcome)` asks /bet-result for each and reports what happened. */
const PENDING_KEY = 'exchange-pending-bets';
const MAX_AGE_MS = 5 * 60 * 1000;
const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const write = (list) => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
};
export function savePendingBet(ref) {
  write([...read().filter((p) => p.ref !== ref), { ref, at: Date.now() }]);
}
export function clearPendingBet(ref) {
  write(read().filter((p) => p.ref !== ref));
}

let reconciling = false;
/**
 * @param {(outcome: {ref:string, state:string, message:string|null}) => void} onOutcome
 *   called once per ref that resolved (accepted → toast BET_PLACED and dispatch `bet:placed`;
 *   rejected → toast the message).
 */
export async function reconcilePendingBets(onOutcome) {
  if (reconciling) return;
  reconciling = true;
  try {
    const now = Date.now();
    for (const p of read()) {
      if (now - p.at > MAX_AGE_MS) { clearPendingBet(p.ref); continue; }
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        let r;
        try { r = await getBetResult(p.ref); } catch { r = null; }
        if (!r) break; // network / auth: keep it for the next load
        if (r.state === 'pending') { await new Promise((res) => setTimeout(res, 1500)); continue; }
        clearPendingBet(p.ref);
        onOutcome?.({ ref: p.ref, state: r.state, message: r.message });
        break;
      }
    }
  } finally {
    reconciling = false;
  }
}

/** The event every exposure / open-bets reader refreshes on (TENEXCH fires it 250ms after a placed bet). */
export const BET_PLACED_EVENT = 'bet:placed';
export function announceBetPlaced(delayMs = 250) {
  setTimeout(() => window.dispatchEvent(new Event(BET_PLACED_EVENT)), delayMs);
}

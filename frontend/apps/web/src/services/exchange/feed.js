import { exchangeRequest, unwrapFeed, POLL_TIMEOUT_MS, ExchangeError } from './api';

/**
 * ─── Feed reads (no auth) ────────────────────────────────────────────────────────────────
 *
 * Shapes returned (all verified live against :4700 on 2026-10-13 — examples in docs/exchange.md):
 *
 * @typedef {object} Odd        { odds:number, oname:'back1'|'back2'|'back3'|'lay1'|…, otype:'back'|'lay',
 *                                size:number, tno:0|1|2 }   — `size` is the RATE on fancy/run lines
 * @typedef {object} Section    a runner: { sid:number (runner id), nat:string (name, untrimmed),
 *                                gstatus:'ACTIVE'|'OPEN'|'SUSPENDED'|'Suspended'|'Ball Running'|'',
 *                                br:boolean (ball running), min, max, sno, odds:Odd[] }
 * @typedef {object} Market     { mid:number, mname:string (send VERBATIM as market_type), gtype:
 *                                'match'|'match1'|'fancy'|'fancy1'|'fancy2'|'oddeven'|'meter'|'khado'|
 *                                'cricketcasino', dtype, status:'OPEN'|'SUSPENDED', min, max, maxb,
 *                                umaxbof, iplay, rc, sno, section:Section[] }
 * @typedef {object} EventRow   one match on a sport board (all-data): { gmid, etid (= sid), cid, cname
 *                                (league), ename ("A v B"), stime ("10/9/2026 10:30:00 AM", local),
 *                                iplay:boolean, tv, bm, f, f1, iscc, gtype, mid, mname, status,
 *                                section:Section[] (the match-odds runners, back1/lay1 only) }
 * @typedef {object} MatchHeader { gmid, etid, cid, cname, ename, stime, iplay, iscc, tv, scard, bm, gtv }
 */

/**
 * Sport board — `POST cricket/all-data {id: sid}`.
 * sid: 1 Soccer · 2 Tennis · 4 Cricket · 10 HorseRace · 65 Greyhound (others as the tree lists).
 * Racing (10/65) answers a COUNTRY > VENUE > RACE tree in t1 instead of flat rows.
 * @returns {Promise<{ t1: EventRow[], t2: EventRow[], events: EventRow[] }>}
 *   t1 / t2 as the provider splits them (t2 is TENEXCH's "tournaments" list — mostly in-play);
 *   `events` is both, de-duplicated by gmid, in-play first.
 */
export async function getSportEvents(sid, { signal } = {}) {
  const body = await exchangeRequest('/cricket/all-data', {
    method: 'POST', json: { id: Number(sid) }, timeout: POLL_TIMEOUT_MS, signal,
  });
  const d = unwrapFeed(body) || {};
  const t1 = Array.isArray(d.t1) ? d.t1 : [];
  const t2 = Array.isArray(d.t2) ? d.t2 : [];
  const seen = new Set();
  const events = [...t2, ...t1]
    .filter((e) => {
      const k = String(e?.gmid ?? '');
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => Number(!!b.iplay) - Number(!!a.iplay));
  return { t1, t2, events };
}

/**
 * Sidebar tree for every sport — `GET all/sports/tree`.
 * @returns {Promise<{ sports: Array<{ name, etid, oid, children: Array<{ name, cid,
 *   children: Array<{ name, gmid, etid, iscc }> }> }>, racing: Array<{ name, etid,
 *   children: Array<{ name, gmid, etid, sdatetime }> }> }>}
 */
export async function getSportsTree({ signal } = {}) {
  const body = await exchangeRequest('/all/sports/tree', { timeout: POLL_TIMEOUT_MS, signal });
  const d = unwrapFeed(body) || {};
  return {
    sports: Array.isArray(d.t1) ? d.t1 : [],
    racing: Array.isArray(d.t2) ? d.t2 : [],
  };
}

/**
 * Hot / latest events strip — `GET v1/sports-get_latest_events`.
 * @returns {Promise<Array<{ id:string (gmid), lid:string, name:string, sportId:number }>>}
 */
export async function getLatestEvents({ signal } = {}) {
  const body = await exchangeRequest('/v1/sports-get_latest_events', { timeout: POLL_TIMEOUT_MS, signal });
  const d = unwrapFeed(body);
  return Array.isArray(d) ? d : [];
}

/* Only a 404/410 proves the match is gone; the controller wraps EVERY upstream failure (502,
   timeout…) in the same `{success:false, error:"Request failed with status code N"}` body, so the
   status is read out of the text. TENEXCH hooks/useMatchData.js isGoneBody. */
export const isGoneBody = (body) => {
  if (!body || body.success !== false) return false;
  if (Number(body.status) === 404 || Number(body.status) === 410) return true;
  return /\b(404|410)\b/.test(String(body.error || body.msg || ''));
};

/**
 * Live markets of one match — `POST cricket/get-match-private-data {gmid, sid}`.
 * The raw feed markets are returned UNSHAPED (useMatchMarkets applies the limit shaping).
 * @returns {Promise<{ state: 'ok'|'no_record'|'gone'|'empty', markets: Market[] }>}
 *   ok         markets present (may still be [] when the provider's cache is cold)
 *   no_record  between rounds (virtual) — inner {success:false, status:300, "No Record Found."}
 *   gone       the provider said 404/410 for this gmid
 * Other failures (5xx, timeout) reject with ExchangeError — they say nothing about the match.
 */
export async function getMatchMarkets(gmid, sid, { signal } = {}) {
  let body;
  try {
    body = await exchangeRequest('/cricket/get-match-private-data', {
      method: 'POST', json: { gmid: Number(gmid) || gmid, sid: Number(sid) || sid }, timeout: POLL_TIMEOUT_MS, signal,
    });
  } catch (e) {
    if (e instanceof ExchangeError && (e.status === 404 || e.status === 410 || isGoneBody(e.body))) {
      return { state: 'gone', markets: [] };
    }
    throw e;
  }
  return readMatchMarkets(body);
}

/**
 * The same answer pushed by the sports socket (oddsSocket.js): the server sends the REST reply as
 * `{ status, body }`, read here exactly as getMatchMarkets reads the HTTP one.
 */
export function readPushedMarkets(status, body) {
  if (status === 404 || status === 410 || (status >= 400 && isGoneBody(body))) return { state: 'gone', markets: [] };
  if (status >= 400) throw new ExchangeError(String(body?.error || `HTTP ${status}`), { status, code: `HTTP_${status}`, body });
  return readMatchMarkets(body);
}

function readMatchMarkets(body) {
  const d = unwrapFeed(body);
  if (Array.isArray(d)) return { state: 'ok', markets: d };
  if (d && d.success === false) {
    if (d.status === 300 || /no record/i.test(String(d.msg || ''))) return { state: 'no_record', markets: [] };
    if (isGoneBody(d)) return { state: 'gone', markets: [] };
  }
  return { state: 'empty', markets: [] };
}

/**
 * Match header — `GET v1/sports-gamedetailPrivate?gmid&etid` (etid = sid). ~380 bytes.
 * @returns {Promise<MatchHeader|null>} null once a (virtual) round has rotated away.
 */
export async function getMatchHeader(gmid, sid, { signal } = {}) {
  const body = await exchangeRequest('/v1/sports-gamedetailPrivate', {
    params: { gmid, etid: sid }, timeout: POLL_TIMEOUT_MS, signal,
  });
  const d = unwrapFeed(body);
  const arr = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : null;
  return arr?.length ? arr[0] : null;
}

/**
 * Scorecard iframe URL — `GET cricket/score-url?gmid&etid`. The token inside is SINGLE-USE: ask
 * once per card and hand it straight to the iframe. Null when the host has none (the route
 * answers 502 {success:false, error:"Scorecard host did not return an animation url"}).
 * @returns {Promise<string|null>}
 */
export async function getScoreUrl(gmid, sid) {
  try {
    const body = await exchangeRequest('/cricket/score-url', { params: { gmid, etid: sid }, timeout: POLL_TIMEOUT_MS });
    return body?.data?.url || null;
  } catch {
    return null;
  }
}

/**
 * Virtual round stream + scorecard — `GET virtual/event-media?gmid&etid`.
 * @returns {Promise<{ gmid:string, etid:string, stream:string|null, score:string|null }|null>}
 */
export async function getVirtualEventMedia(gmid, sid) {
  try {
    const body = await exchangeRequest('/virtual/event-media', { params: { gmid, etid: sid }, timeout: POLL_TIMEOUT_MS });
    return body?.success ? body.data : null;
  } catch {
    return null;
  }
}

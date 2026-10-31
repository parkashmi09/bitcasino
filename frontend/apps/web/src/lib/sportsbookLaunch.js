import { api, ApiError } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';

/**
 * The real sportsbook, as rainbet and SmartBet open it: an iframe from the provider.
 *
 *   1. Slotegrator — `GET /casino/sportsbook` lists the books; `POST /casino/sportsbook/init` opens a
 *      session (`{ sessionId, url }`). A second init answers 409 SPORTSBOOK_SESSION_ALREADY_OPEN with
 *      the open session's id, which `/refresh` turns into a fresh URL.
 *   2. Not configured (503 *_NOT_CONFIGURED, the usual case today) → LuckySports, a JSGames V2
 *      catalogue book, through `POST /casino/games/launch` (INR only upstream).
 *
 * The backend refuses both with 403 NOT_ENTITLED unless the owner panel has Site flags → `sports`
 * and `sportsbook` on; `lib/gates.js` hides `/sports` in that case, so this is rarely reached.
 */
const LUCKY_SPORTS_UID = import.meta.env.VITE_SPORTSBOOK_GAME_UID || '8a704858d5deb4af1ddc722092ac7614';
const SB_KEY = 'bc.sportsbookSession';

// Remembered for this page load: a site without Slotegrator goes straight to LuckySports next time.
let slotegratorMissing = false;

const device = () => (window.matchMedia?.('(max-width: 767px)').matches ? 'mobile' : 'desktop');
const notConfigured = (e) => e instanceof ApiError && /NOT_CONFIGURED/.test(e.code);

function remember(bookUuid, sessionId) {
  try {
    sessionStorage.setItem(SB_KEY, JSON.stringify({ bookUuid, sessionId }));
  } catch {
    // storage blocked: the session just isn't closed on sign-out
  }
}

async function slotegrator(currency) {
  if (slotegratorMissing) return null;
  let books;
  try {
    const list = await api(ENDPOINTS.sportsbooks);
    books = Array.isArray(list) ? list : (list?.items ?? list?.rows ?? list?.data ?? []);
  } catch (e) {
    if (notConfigured(e)) slotegratorMissing = true;
    else if (!(e instanceof ApiError) || e.status === 401) throw e;
    return null;
  }
  const uuid = books.map((b) => b.uuid ?? b.sportsbook_uuid ?? b.id).find(Boolean);
  if (!uuid) return null;
  const body = { sportsbookUuid: String(uuid), currency, language: 'en', returnUrl: window.location.origin };
  try {
    const s = await api(ENDPOINTS.sportsbookInit, { method: 'POST', body });
    remember(uuid, s.sessionId);
    return s.url ? { url: s.url, via: 'sportsbook' } : null;
  } catch (e) {
    const open = e instanceof ApiError && e.code === 'SPORTSBOOK_SESSION_ALREADY_OPEN' ? String(e.details?.sessionId ?? '') : '';
    if (open) {
      const s = await api(ENDPOINTS.sportsbookRefresh, { method: 'POST', body: { sessionId: open } });
      remember(uuid, s.sessionId);
      return s.url ? { url: s.url, via: 'sportsbook' } : null;
    }
    if (notConfigured(e)) {
      slotegratorMissing = true;
      return null;
    }
    throw e;
  }
}

/** `{ url, via }` for the sportsbook iframe; throws an ApiError when the backend refuses. */
export async function launchSportsbook(currency = 'INR') {
  const book = await slotegrator(currency);
  if (book) return book;
  const res = await api(ENDPOINTS.gameLaunch, {
    method: 'POST',
    body: { gameUuid: LUCKY_SPORTS_UID, currencyCode: 'INR', device: device() },
  });
  if (!res?.gameLaunchUrl) throw new ApiError({ code: 'JSGAMES_UPSTREAM_REJECTED', message: 'No sportsbook URL', status: 502 });
  return { url: res.gameLaunchUrl, via: res.via === 'slotegrator' ? 'slotegrator' : 'jsgames-v2' };
}

/** Close a Slotegrator session on sign-out. Best effort, before the token is cleared. */
export async function closeSportsbookSession() {
  try {
    const raw = sessionStorage.getItem(SB_KEY);
    if (!raw) return;
    sessionStorage.removeItem(SB_KEY);
    const { sessionId } = JSON.parse(raw);
    if (sessionId) await api(ENDPOINTS.sportsbookLogout, { method: 'POST', body: { sessionId } });
  } catch {
    // nothing to close
  }
}

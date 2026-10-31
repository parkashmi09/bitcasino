/**
 * Idle logout, the player side (backend: user-service AuthService.idleCheck / sweepIdleSessions).
 *
 * While signed in and while the site config says idle logout is on (`idleLogoutMinutes`), the
 * player's own interaction (pointer, keys, touch, wheel/scroll, the tab becoming visible) sends
 * `POST /user/auth/activity` at most once a minute — a trailing one too, so the server never lags
 * the last interaction. Background polling never calls it. After `minutes` with no interaction the
 * tracker asks `POST /user/auth/idle-check`; the server decides (a bet counts as activity, so a
 * player inside a game iframe, whose clicks never reach this page, is kept), and either answers
 * `nextCheckAt` or has signed the session out.
 *
 * Framework-free and identical in every player site; each site wraps it in its own hook.
 *
 * @param {object}   o
 * @param {number}   o.minutes      the idle window
 * @param {Function} o.ping         () => Promise — POST /user/auth/activity
 * @param {Function} o.check        () => Promise<{signedOut, nextCheckAt?}> — POST /user/auth/idle-check
 * @param {Function} o.hasSession   () => boolean — still holding tokens (a failed check may mean the sweep won)
 * @param {Function} o.onSignedOut  () => void — clear the session like logout does, show the notice
 * @returns {Function} stop
 */
export function startIdleTracker({ minutes, ping, check, hasSession, onSignedOut }) {
  const windowMs = minutes * 60_000;
  const PING_EVERY_MS = 60_000;
  const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll'];
  let idleTimer = null;
  let pingTimer = null;
  let lastPing = 0;
  let lastArm = 0;
  let stopped = false;

  const sendPing = () => {
    pingTimer = null;
    lastPing = Date.now();
    Promise.resolve().then(ping).catch(() => {});
  };

  const arm = (ms) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdle, ms);
  };

  const onActivity = (event) => {
    if (stopped || (event?.type === 'visibilitychange' && document.visibilityState !== 'visible')) return;
    const now = Date.now();
    // pointermove fires constantly; re-arming once a second is plenty.
    if (now - lastArm > 1000) {
      lastArm = now;
      arm(windowMs);
    }
    if (now - lastPing >= PING_EVERY_MS) sendPing();
    else if (!pingTimer) pingTimer = setTimeout(sendPing, lastPing + PING_EVERY_MS - now);
  };

  async function onIdle() {
    if (stopped) return;
    let answer;
    try {
      answer = await check();
    } catch {
      answer = hasSession() ? null : { signedOut: true };
    }
    if (stopped) return;
    if (answer?.signedOut) {
      stop();
      onSignedOut();
      return;
    }
    const next = answer?.nextCheckAt ? new Date(answer.nextCheckAt).getTime() - Date.now() : windowMs;
    arm(Math.max(5_000, Number.isFinite(next) ? next : windowMs));
  }

  function stop() {
    stopped = true;
    clearTimeout(idleTimer);
    clearTimeout(pingTimer);
    for (const name of EVENTS) window.removeEventListener(name, onActivity, true);
    document.removeEventListener('visibilitychange', onActivity);
  }

  for (const name of EVENTS) window.addEventListener(name, onActivity, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onActivity);
  onActivity(); // opening or reloading the site is the player's own doing
  return stop;
}

export const idleNotice = (minutes) => `You were signed out after ${minutes} minute${minutes === 1 ? '' : 's'} of inactivity`;

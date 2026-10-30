import React from 'react';
import { getSportsTree } from '../../services/exchange/feed';

/* ─── The sports tree, read ONCE for the whole app ─────────────────────────────────────────
 *
 * `GET all/sports/tree` feeds the main sidebar's Sports group (and anything else that wants the
 * tree). Every caller shares one poll loop: the first subscriber starts it, the last one to
 * unmount stops it, and a second subscriber gets the cached answer at once instead of a second
 * request. Same cadence as before (60s, self-scheduling, paused while the tab is hidden, an
 * immediate read on return) and the same `{ data, error, loading }` shape `usePolling` returns,
 * with `data` undefined until the first answer and kept across a failed refresh.
 */

const INTERVAL_MS = 60000;

let state = { data: undefined, error: null };
let subscribers = 0;
let timer = null;
let controller = null;
let gen = 0;
const listeners = new Set();

const publish = (next) => {
  state = next;
  listeners.forEach((fn) => fn());
};

async function run(myGen) {
  if (myGen !== gen || subscribers === 0) return;
  const startedAt = Date.now();
  controller = new AbortController();
  try {
    const data = await getSportsTree({ signal: controller.signal });
    if (myGen === gen) publish({ data, error: null });
  } catch (error) {
    if (myGen === gen && error?.name !== 'AbortError') publish({ data: state.data, error });
  } finally {
    if (myGen === gen && subscribers > 0 && !document.hidden) {
      timer = setTimeout(() => run(myGen), Math.max(0, INTERVAL_MS - (Date.now() - startedAt)));
    }
  }
}

function kick() {
  clearTimeout(timer);
  controller?.abort();
  gen += 1;
  run(gen);
}

const onVisibility = () => {
  if (document.hidden) clearTimeout(timer);
  else kick();
};

function subscribe(listener) {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) {
    document.addEventListener('visibilitychange', onVisibility);
    kick();
  }
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers === 0) {
      clearTimeout(timer);
      controller?.abort();
      gen += 1;
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

const getSnapshot = () => state;

/** Sports tree, 60s, one shared poll. data: { sports, racing } (services/exchange/feed.js). */
export function useSharedSportsTree({ enabled = true } = {}) {
  const sub = React.useCallback((listener) => (enabled ? subscribe(listener) : () => {}), [enabled]);
  const snap = React.useSyncExternalStore(sub, getSnapshot, getSnapshot);
  return {
    data: enabled ? snap.data : undefined,
    error: enabled ? snap.error : null,
    loading: enabled && snap.data === undefined && !snap.error,
    refresh: kick,
  };
}

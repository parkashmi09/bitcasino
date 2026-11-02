import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { useAuth } from '@/auth/AuthProvider';
import { toGame } from '@/data/adapters/games';
import { toast } from '@/lib/toast';

/**
 * The player's favourite games: on the account (`/casino/games/favourites`) when
 * signed in, on this device when signed out. Stars made signed out move to the
 * account at sign-in. The notes below describe the device store.
 *
 * ## Why the whole game, and not just an id
 *
 * The reference stores favourites server-side and reads them back with a
 * `myFavourites` query sorted `addedTime: -1`. This platform has no favourites
 * table — `docs/11` has carried that as a known gap — so the feature lives in
 * `localStorage`, the same carve-out `GameActions` and `usePreferences` already
 * make for state that is useful entirely on one device.
 *
 * Storing an id alone would mean the Favourites page could not draw a tile
 * without a second request that can resolve a uuid, and there is no by-ids
 * route to make that request against: `GET /games` pages at 100 and cannot be
 * asked for a set. So the snapshot the player was looking at when they pressed
 * the star is what is kept. It is a few hundred bytes per game, it renders the
 * page without a network round trip, and a title that later leaves the
 * catalogue still shows the art it had.
 *
 * ## One store, many readers
 *
 * The star lives on the game page and the count lives in the sidebar, which is
 * a different branch of the tree. `useSyncExternalStore` is what keeps them in
 * step without a context provider or a window event — the reference dispatches
 * `favouriteToggle` on `window` and the sidebar listens for it; here the store
 * notifies its own subscribers instead.
 *
 * The key and the shape are the ones `GameActions` already wrote
 * (`{ [gameId]: game }`), so a favourite added before this page existed is
 * carried over rather than stranded. Values that are not game objects — the
 * `true` flags the old boolean form left behind — are dropped on read, since
 * there is nothing in them to draw.
 */

const STORAGE_KEY = 'bitcasino:favourites';

/** A game object worth rendering: `GameCard` keys on `slug`. */
const isGame = (value) => Boolean(value) && typeof value === 'object' && Boolean(value.slug);

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, game]) => isGame(game)));
  } catch {
    return {};
  }
}

let current = null;
/** User id whose server list is in `current`, or null while the device list is. */
let serverFor = null;
const listeners = new Set();

const store = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /**
   * Referentially stable between writes — `useSyncExternalStore` re-renders on
   * every `Object.is` miss, so building a fresh object here would loop.
   */
  get() {
    current ??= read();
    return current;
  },
  set(next) {
    current = next;
    if (!serverFor) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The change still applies to this tab; it just will not outlive it.
      }
    }
    for (const listener of listeners) listener();
  },
};

/** The server snapshot: no storage to read, and never re-rendered from. */
const EMPTY = Object.freeze({});

/**
 * `{ games, count, isFavourite, toggle }`.
 *
 * `games` is newest-first, matching the reference's `addedTime: -1` sort.
 * `count` is that list's length, so the sidebar badge can never disagree with
 * what opening the page shows. `toggle(game)` takes the whole `Game`, because
 * that is what gets stored.
 */
/** Switch the store to `userId`'s server list (null = back to the device list). */
async function loadFor(userId) {
  if (serverFor === userId) return;
  if (!userId) {
    serverFor = null;
    store.set(read());
    return;
  }
  serverFor = userId;
  // Stars made signed out go to the account first, then the device list is cleared.
  const device = read();
  const local = Object.keys(device);
  const results = await Promise.allSettled(local.map((id) => star(id, true)));
  // Only the stars the account took leave the device; failed ones retry at the next sign-in.
  const failed = local.filter((_, i) => results[i].status === 'rejected');
  try {
    if (failed.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(failed.map((id) => [id, device[id]]))));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing kept on this device to clear.
  }
  try {
    const rows = await api(ENDPOINTS.favourites, { query: { limit: 500 } });
    if (serverFor !== userId) return;
    // Oldest first, so `games` (insertion order reversed) reads newest first like the server.
    const games = (Array.isArray(rows) ? rows : []).map((r) => toGame(r?.game)).filter(isGame).reverse();
    store.set(Object.fromEntries(games.map((g) => [g.id, g])));
  } catch {
    if (serverFor === userId) store.set({});
  }
}

const star = (id, on) =>
  api(path(ENDPOINTS.favourite, { gameRef: id }), on ? { method: 'PUT', body: {} } : { method: 'DELETE' });

export function useFavourites() {
  const favourites = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);
  const { user, status } = useAuth();
  const userId = status === 'authenticated' ? (user?.id ?? null) : null;
  useEffect(() => {
    if (status !== 'loading') loadFor(userId);
  }, [status, userId]);

  const games = useMemo(() => Object.values(favourites).reverse(), [favourites]);

  const isFavourite = useCallback((id) => Boolean(favourites[id]), [favourites]);

  const toggle = useCallback((game) => {
    if (!game?.id) return;
    const before = store.get();
    const on = !before[game.id];
    const next = { ...before };
    if (on) next[game.id] = game;
    else delete next[game.id];
    store.set(next);
    if (!serverFor) return;
    star(game.id, on).catch((error) => {
      // Put the star back the way the server has it.
      const undo = { ...store.get() };
      if (on) delete undo[game.id];
      else undo[game.id] = before[game.id];
      store.set(undo);
      toast.error(error?.message || 'Could not update your favourites.');
    });
  }, []);

  return { games, count: games.length, isFavourite, toggle };
}

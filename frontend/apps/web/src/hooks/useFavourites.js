import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * The player's favourite games, kept on this device.
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The change still applies to this tab; it just will not outlive it.
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
export function useFavourites() {
  const favourites = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);

  const games = useMemo(() => Object.values(favourites).reverse(), [favourites]);

  const isFavourite = useCallback((id) => Boolean(favourites[id]), [favourites]);

  const toggle = useCallback((game) => {
    if (!game?.id) return;
    const next = { ...store.get() };
    if (next[game.id]) delete next[game.id];
    else next[game.id] = game;
    store.set(next);
  }, []);

  return { games, count: games.length, isFavourite, toggle };
}

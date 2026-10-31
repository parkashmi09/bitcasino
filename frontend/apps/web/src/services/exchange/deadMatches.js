import React from 'react';

/* ─── Matches the provider has dropped ─────────────────────────────────────────────────────
 *
 * The sports tree (`all/sports/tree`) and the sport boards (`cricket/all-data`) keep listing a
 * match for a while after the provider has stopped serving it: its market read answers 404/410
 * and the match page says "This match is no longer available". The feed carries no finished
 * flag to filter on (`status` is only OPEN/SUSPENDED, and a SUSPENDED in-play match is very much
 * alive), so the 404 itself is the signal: the match page records the gmid here the moment it
 * learns the match is gone, and every list (sidebar tree, lobby boards, in-play) drops it.
 *
 * Kept in sessionStorage for TTL_MS so a reload does not bring the dead row straight back, and
 * expired after that in case the provider ever reopens the same id.
 */

const KEY = 'hge.deadMatches';
const TTL_MS = 6 * 60 * 60 * 1000;

function load() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    const now = Date.now();
    return new Map(Object.entries(raw).filter(([, at]) => typeof at === 'number' && now - at < TTL_MS));
  } catch {
    return new Map();
  }
}

let dead = typeof window === 'undefined' ? new Map() : load();
let version = 0;
const listeners = new Set();

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(dead)));
  } catch {
    /* private mode: in-memory only */
  }
}

/** Record that the provider no longer serves this match (its market read answered 404/410). */
export function markMatchGone(gmid) {
  const id = String(gmid ?? '');
  if (!id || dead.has(id)) return;
  dead = new Map(dead).set(id, Date.now());
  version += 1;
  save();
  listeners.forEach((fn) => fn());
}

/** The match answered with markets again (a provider blip, not a removal): list it again. */
export function reviveMatch(gmid) {
  const id = String(gmid ?? '');
  if (!dead.has(id)) return;
  dead = new Map(dead);
  dead.delete(id);
  version += 1;
  save();
  listeners.forEach((fn) => fn());
}

/** Is this match known to be gone? */
export const isMatchGone = (gmid) => dead.has(String(gmid ?? ''));

/** Drop known-dead matches from a list of rows carrying `gmid` (or `id`, the latest-events shape). */
export const withoutDeadMatches = (rows) =>
  Array.isArray(rows) && dead.size ? rows.filter((r) => !isMatchGone(r?.gmid ?? r?.id)) : rows;

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => version;

/** Re-renders the caller when a match is marked gone; returns a version to key memos on. */
export function useDeadMatchesVersion() {
  return React.useSyncExternalStore(subscribe, snapshot, () => 0);
}

/** The sports tree (`{ sports, racing }`) with known-dead matches removed, and any competition
 *  left empty by that removal dropped too. Same object back when nothing is dead. */
export function treeWithoutDead(tree) {
  if (!tree || !dead.size) return tree;
  const list = (v) => (Array.isArray(v) ? v : []);
  const sports = list(tree.sports).map((sport) => ({
    ...sport,
    children: list(sport.children)
      .map((comp) => ({ ...comp, children: list(comp.children).filter((m) => !isMatchGone(m?.gmid)) }))
      .filter((comp) => comp.children.length > 0),
  }));
  const racing = list(tree.racing).map((venue) => ({
    ...venue,
    children: list(venue.children).filter((m) => !isMatchGone(m?.gmid)),
  }));
  return { ...tree, sports, racing };
}

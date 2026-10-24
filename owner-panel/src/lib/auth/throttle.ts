/**
 * Login throttling, in memory (one process, one owner — no store needed).
 *
 * Per client: 5 free failures in 15 min, then a lockout that doubles with each
 * further failure (30 s, 60 s, … capped at 1 h). Globally: 30 failures in 15 min
 * from anyone closes the login for 15 min, so rotating addresses (or a spoofed
 * x-forwarded-for) does not buy unlimited guesses. A success clears that client.
 */
const WINDOW_MS = 15 * 60 * 1000
const FREE_FAILURES = 5
const BASE_LOCK_MS = 30 * 1000
const MAX_LOCK_MS = 60 * 60 * 1000
const GLOBAL_MAX = 30

type Entry = { failures: number; first: number; lockedUntil: number }

const clients = new Map<string, Entry>()
let global: { count: number; first: number; lockedUntil: number } = { count: 0, first: 0, lockedUntil: 0 }

/** Milliseconds this client must wait, or 0 when it may try. */
export function loginWait(client: string, now = Date.now()) {
  const own = clients.get(client)
  const wait = Math.max(global.lockedUntil - now, own ? own.lockedUntil - now : 0)

  return wait > 0 ? wait : 0
}

export function loginFailed(client: string, now = Date.now()) {
  let own = clients.get(client)

  if (!own || now - own.first > WINDOW_MS) own = { failures: 0, first: now, lockedUntil: 0 }
  own.failures += 1
  if (own.failures > FREE_FAILURES) own.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (own.failures - FREE_FAILURES - 1))
  clients.set(client, own)

  if (now - global.first > WINDOW_MS) global = { count: 0, first: now, lockedUntil: global.lockedUntil }
  global.count += 1
  if (global.count >= GLOBAL_MAX) global.lockedUntil = now + WINDOW_MS

  // Forget stale clients so the map cannot grow without bound.
  if (clients.size > 1000) for (const [key, e] of clients) if (now - e.first > WINDOW_MS && e.lockedUntil < now) clients.delete(key)
}

export function loginSucceeded(client: string) {
  clients.delete(client)
}

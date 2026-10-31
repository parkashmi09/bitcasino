'use client'

import { useSyncExternalStore } from 'react'

/**
 * Whether the realtime socket (components/shared/RealtimeRefresh) is connected. While it is,
 * owner / operator saves arrive as pushes and the config reads need no timer; when it drops,
 * `livePoll` hands the old interval back so nothing goes stale.
 */
let connected = false
const listeners = new Set<() => void>()

export function setRealtimeConnected(on: boolean) {
  if (connected === on) return
  connected = on
  listeners.forEach(fn => fn())
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)

  return () => listeners.delete(fn)
}

export const useRealtimeConnected = () => useSyncExternalStore(subscribe, () => connected, () => false)

/** `ms` while the socket is down, no polling while it is up. */
export function useLivePoll(ms: number): number | false {
  return useRealtimeConnected() ? false : ms
}

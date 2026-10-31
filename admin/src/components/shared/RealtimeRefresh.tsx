'use client'

// React Imports
import { useEffect } from 'react'

// Third-party Imports
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'

// Config Imports
import { siteConfig } from '@/configs/site'
import { REALTIME_EVENTS, REALTIME_PREFIXES, isStale } from '@/lib/realtime-keys'
import { setRealtimeConnected } from '@/lib/realtime-status'

/**
 * Live refresh of the config screens: when the owner or another operator saves flags, branding,
 * features, coins or the plan, every open admin tab refetches what that save changed.
 *
 * It listens on the player site's socket (user-service `/socket.io`), ANONYMOUSLY: those pushes are
 * broadcast to every socket, so the httpOnly staff token never has to reach the browser. The
 * socket dials the gateway itself, not `/api/gw` (a Next route cannot carry the socket), so the
 * gateway's SOCKET_ALLOWED_ORIGINS must list this admin's origin.
 *
 * Renders nothing; mounted once in the signed-in layout.
 */
const SOCKET_BASE = (process.env.NEXT_PUBLIC_SOCKET_BASE || siteConfig.apiBaseUrl).replace(/\/+$/, '')

// WebSocket, like the player site; NEXT_PUBLIC_SOCKET_TRANSPORT=polling falls back to long-polling for a proxy that drops the upgrade.
const WS = process.env.NEXT_PUBLIC_SOCKET_TRANSPORT !== 'polling'

// One save fires up to three pushes (flags, features, coins): refetch once.
const DEBOUNCE_MS = 300

/* The player site's sync (frontend/src/services/realtime.js): every TICK_MS the socket is asked
   for the whole state; the site half (flags, features, coins, branding) changing means the owner
   or an operator saved, even when a push was missed. The reply is XOR-scrambled with
   sha256(`${socket.id}:${SALT}`) — obfuscation, not a secret (backend modules/sync/sockets.js). */
const SYNC_STATE = '3b84d3951808e13e1b8c65a67d6b7235'
const SALT = 'p567.sync.v1'
const TICK_MS = 2000

async function unscramble(d: string, id: string): Promise<Record<string, unknown>> {
  const key = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${id}:${SALT}`)))
  const bytes = Uint8Array.from(atob(d), c => c.charCodeAt(0))

  for (let i = 0; i < bytes.length; i += 1) bytes[i] ^= key[i % key.length]

  return JSON.parse(new TextDecoder().decode(bytes))
}

const siteSig = (s: Record<string, unknown>) => JSON.stringify([s.flags, s.features, s.currencies, s.branding])

const RealtimeRefresh = () => {
  const qc = useQueryClient()

  useEffect(() => {
    // Same transport settings as the player site (frontend/src/services/realtime.js).
    const socket = io(SOCKET_BASE, {
      path: '/socket.io',
      transports: WS ? ['websocket', 'polling'] : ['polling'],
      tryAllTransports: WS,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    })

    // Connected: the config reads stop polling (lib/realtime-status). On a reconnect, read once —
    // a push may have been missed while the socket was down.
    socket.on('connect', () => {
      setRealtimeConnected(true)
      void qc.invalidateQueries({ predicate: q => isStale(q.queryKey, REALTIME_PREFIXES['entitlements:changed']) })
    })
    socket.on('disconnect', () => setRealtimeConnected(false))

    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined

    let sig: string | null = null
    let inFlight = false

    const sync = () => {
      if (!socket.connected || inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      const id = socket.id ?? ''

      socket.timeout(8000).emit(SYNC_STATE, null, (err: unknown, reply: unknown) => {
        inFlight = false
        if (err) return
        let body: { status?: boolean; d?: unknown } | null = null

        try {
          body = JSON.parse(typeof reply === 'string' ? reply : JSON.stringify(reply))
        } catch {
          return
        }

        if (!body?.status || typeof body.d !== 'string') return
        unscramble(body.d, id).then(
          state => {
            const next = siteSig(state)

            if (sig !== null && next !== sig) void qc.invalidateQueries({ predicate: q => isStale(q.queryKey, REALTIME_PREFIXES['entitlements:changed']) })
            sig = next
          },
          () => {}
        )
      })
    }

    const tick = setInterval(sync, TICK_MS)

    const flush = () => {
      const prefixes = [...pending]

      pending.clear()
      void qc.invalidateQueries({ predicate: q => isStale(q.queryKey, prefixes) })
    }

    for (const event of REALTIME_EVENTS) {
      socket.on(event, () => {
        REALTIME_PREFIXES[event].forEach(p => pending.add(p))
        clearTimeout(timer)
        timer = setTimeout(flush, DEBOUNCE_MS)
      })
    }

    return () => {
      clearInterval(tick)
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.disconnect()
      setRealtimeConnected(false)
    }
  }, [qc])

  return null
}

export default RealtimeRefresh

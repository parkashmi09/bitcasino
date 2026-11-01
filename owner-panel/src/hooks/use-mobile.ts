import * as React from 'react'

const MOBILE_BREAKPOINT = 1280
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)

  mql.addEventListener('change', onChange)

  return () => mql.removeEventListener('change', onChange)
}

const getSnapshot = () => window.matchMedia(QUERY).matches

// The server has no viewport: it (and the hydrating client render) always draws the desktop
// sidebar, then React re-renders with the real width — no hydration mismatch below 1280px.
const getServerSnapshot = () => false

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

const noopSubscribe = () => () => {}

/**
 * False while this component is server-rendered or hydrating, true afterwards.
 * Unlike a context value, it is evaluated per component, so a subtree that hydrates
 * later (e.g. behind a <Suspense> boundary) still sees `false` during its own hydration
 * and renders the same markup the server sent.
 */
export function useHydrated() {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
}

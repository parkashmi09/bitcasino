/**
 * Where a login may send the player next: a same-origin relative path only
 * (hash-game-exchange's `safeNext`). Takes a guard's `state.from` location or
 * a `?next=` string; anything absolute, protocol-relative (`//evil.com`,
 * `/\evil.com`) or carrying control characters falls back to `/`.
 */
export function safeNext(target, fallback = '/') {
  const path =
    typeof target === 'string'
      ? target
      : target?.pathname
        ? `${target.pathname}${target.search ?? ''}${target.hash ?? ''}`
        : '';
  // eslint-disable-next-line no-control-regex
  if (!path.startsWith('/') || /^\/[/\\]/.test(path) || /[\u0000-\u001f\\]/.test(path)) return fallback;
  return path;
}

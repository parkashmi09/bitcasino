// Resolve with the URL parser the browser will use, not string prefixes: it drops tab/CR/LF and reads
// `\` as `/`, so `/\t/evil.example` would otherwise become `//evil.example` after an owner sign-in.
const BASE = 'http://owner.invalid'

export function safeNext(next: string | null | undefined, fallback = '/overview'): string {
  if (!next || !next.startsWith('/')) return fallback

  try {
    const url = new URL(next, BASE)

    const path = url.pathname + url.search + url.hash

    // Dot segments can normalize to `//host` (`/.//evil.example`), which is protocol-relative again.
    return url.origin === BASE && !path.startsWith('//') ? path : fallback
  } catch {
    return fallback
  }
}

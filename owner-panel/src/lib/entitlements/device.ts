/**
 * A short "OS · browser" name from a User-Agent (and the platform client hint, when the browser
 * sent one). Logs never carry the maker or model of a desktop (Lenovo, Dell…): only the OS.
 */
export function deviceOf(userAgent?: string | null, platform?: string | null, mobile?: boolean | null): string | null {
  const ua = userAgent ?? ''

  if (!ua && !platform) return null
  if (/^node\b|^undici|^axios|^curl\/|^python|^go-http|^postman/i.test(ua)) return `Script / server (${ua.split(/[\s/]/)[0] || 'unknown'})`

  const os = /Windows NT 10\.0/.test(ua)
    ? 'Windows 10/11'
    : /Windows NT/.test(ua)
      ? 'Windows'
      : /iPhone/.test(ua)
        ? 'iPhone'
        : /iPad/.test(ua)
          ? 'iPad'
          : /Android/.test(ua)
            ? `Android${ua.match(/Android ([\d.]+)/)?.[1] ? ` ${ua.match(/Android ([\d.]+)/)?.[1]}` : ''}`
            : /Mac OS X/.test(ua)
              ? 'Mac'
              : /CrOS/.test(ua)
                ? 'ChromeOS'
                : /Linux/.test(ua)
                  ? 'Linux'
                  : platform || 'Unknown OS'

  const browser = /Edg\//.test(ua)
    ? `Edge ${ua.match(/Edg\/(\d+)/)?.[1] ?? ''}`
    : /OPR\//.test(ua)
      ? `Opera ${ua.match(/OPR\/(\d+)/)?.[1] ?? ''}`
      : /Firefox\//.test(ua)
        ? `Firefox ${ua.match(/Firefox\/(\d+)/)?.[1] ?? ''}`
        : /Chrome\//.test(ua)
          ? `Chrome ${ua.match(/Chrome\/(\d+)/)?.[1] ?? ''}`
          : /Safari\//.test(ua)
            ? `Safari ${ua.match(/Version\/(\d+)/)?.[1] ?? ''}`
            : ua
              ? ua.slice(0, 40)
              : 'Unknown browser'

  return `${os}${mobile ? ' (mobile)' : ''} · ${browser.trim()}`
}

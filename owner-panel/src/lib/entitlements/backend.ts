import 'server-only'

import { serverConfig } from '@/configs/site'
import { HttpError } from '@/lib/owner/guard'

/**
 * The site backend's owner API (`<SITE_GATEWAY_URL>/api/v1/admin/owner/…`, admin-service
 * modules/owner), where the entitlement document, its audit trail and the branding images live
 * (tables owner_entitlements, owner_audit, owner_branding_assets). This panel keeps nothing on
 * disk, so a local and a live panel pointed at the same gateway read and write the same data.
 * Server-side only: `x-owner-key` is OWNER_SHARED_SECRET from env, never sent to the browser.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export async function ownerApi(path: string, init: RequestInit = {}): Promise<Response> {
  const base = serverConfig.gatewayUrl.replace(/\/$/, '')

  if (!base || !serverConfig.sharedSecret) throw new HttpError(503, 'BACKEND_NOT_CONFIGURED', 'SITE_GATEWAY_URL / OWNER_SHARED_SECRET not set')

  const { protocol, hostname } = new URL(base)

  // The key never crosses a network in clear.
  if (protocol !== 'https:' && !(protocol === 'http:' && LOOPBACK.has(hostname))) {
    throw new HttpError(503, 'BACKEND_NOT_CONFIGURED', 'SITE_GATEWAY_URL must be https:// unless it is this host')
  }

  try {
    return await fetch(`${base}/api/v1/admin/owner${path}`, {
      ...init,
      headers: { 'x-owner-key': serverConfig.sharedSecret, accept: 'application/json', ...init.headers },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    })
  } catch (error) {
    throw new HttpError(502, 'BACKEND_UNREACHABLE', `The site backend did not answer (${error instanceof Error ? error.message : 'unreachable'})`)
  }
}

/** `data` of a JSON answer; the backend's own code and message on an error (409 VERSION_CONFLICT, …). */
export async function ownerJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await ownerApi(path, init)
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null

  if (!res.ok) {
    const status = res.status >= 500 || res.status === 401 ? 502 : res.status

    throw new HttpError(status, body?.error?.code ?? 'BACKEND_ERROR', body?.error?.message ?? `The site backend answered ${res.status}`)
  }

  return body?.data as T
}

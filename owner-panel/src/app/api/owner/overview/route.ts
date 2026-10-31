import { serverConfig } from '@/configs/site'
import { readAudit, readEntitlements } from '@/lib/entitlements/store'
import type { Overview, Probe } from '@/lib/entitlements/types'
import { handler, ok } from '@/lib/owner/guard'

export const dynamic = 'force-dynamic'

/** Anonymous GET only — no staff credentials, nothing but reachability. */
async function probe(url: string): Promise<Probe> {
  if (!url) return { url, ok: false, status: null, ms: null, error: 'Not configured' }
  const started = Date.now()

  try {
    const res = await fetch(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(4000) })

    return { url, ok: res.status < 500, status: res.status, ms: Date.now() - started }
  } catch (error) {
    return { url, ok: false, status: null, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
  }
}

export const GET = handler(async () => {
  const { siteKey, siteName, gatewayUrl, adminUrl, frontendUrl } = serverConfig

  const [doc, audit, gateway, admin, frontend] = await Promise.all([
    readEntitlements(),
    readAudit(1),
    probe(gatewayUrl ? `${gatewayUrl.replace(/\/$/, '')}/health` : ''),
    probe(adminUrl),
    probe(frontendUrl)
  ])

  const values = [...Object.values(doc.features), ...Object.values(doc.flags)]
  const entitled = values.filter(Boolean).length

  const data: Overview = {
    // The owner's Branding name when set (what players see), else the deployment's SITE_NAME.
    site: { key: siteKey, name: doc.branding?.siteName || siteName, gatewayUrl, adminUrl, frontendUrl },
    health: { gateway: { ...gateway, ok: gateway.status === 200 }, admin, frontend },
    entitlements: { version: doc.version, updatedAt: doc.updatedAt, template: doc.template, lastSave: audit[0] ?? null, entitled, blocked: values.length - entitled, total: values.length }
  }

  return ok(data)
})

import { readAudit } from '@/lib/entitlements/store'
import { handler, ok } from '@/lib/owner/guard'

export const dynamic = 'force-dynamic'

export const GET = handler(async () => ok(await readAudit()))

import { siteMethods } from '@/lib/entitlements/siteMethods'
import { handler, ok } from '@/lib/owner/guard'

export const dynamic = 'force-dynamic'

/** The site's payment methods (seeded, the Super Admin's and the owner's), for the F2Pay methods editor. */
export const GET = handler(async () => ok(await siteMethods()))

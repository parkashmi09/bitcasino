import { siteCoins } from '@/lib/entitlements/siteCoins'
import { handler, ok } from '@/lib/owner/guard'

export const dynamic = 'force-dynamic'

/** Every coin the site knows (names, images, networks, the site's own switch), for the Coins screen. */
export const GET = handler(async () => ok(await siteCoins()))

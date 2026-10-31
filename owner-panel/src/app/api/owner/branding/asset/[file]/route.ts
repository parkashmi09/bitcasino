import type { NextRequest } from 'next/server'

import { readAsset } from '@/lib/entitlements/brandingAssets'
import { handler, HttpError } from '@/lib/owner/guard'
import { imageResponse } from '@/lib/entitlements/brandingResponse'

export const dynamic = 'force-dynamic'

/** An uploaded branding image, for the owner screen's previews (session). */
export const GET = handler(async (_req: NextRequest, ctx: { params: Promise<{ file: string }> }) => {
  const asset = await readAsset((await ctx.params).file)

  if (!asset) throw new HttpError(404, 'NOT_FOUND', 'No such image')

  return imageResponse(asset)
})

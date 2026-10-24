import type { NextRequest } from 'next/server'

import { BRANDING_SLOTS, MAX_IMAGE_BYTES, type BrandingSlot } from '@/lib/entitlements/branding'
import { storeUpload } from '@/lib/entitlements/brandingAssets'
import { handler, HttpError, ok } from '@/lib/owner/guard'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/owner/branding/upload?slot=logo|mark|ogImage`, multipart with one `file`.
 * Checks the bytes (PNG / WebP by magic bytes, SVG only when inert, size and shape per slot),
 * uploads them to the site backend as `<sha256>.<ext>` and answers the image's reference. Nothing is in use
 * until a save of the document names it (Review and save on the Branding screen).
 */
export const POST = handler(async (req: NextRequest) => {
  const slot = req.nextUrl.searchParams.get('slot') as BrandingSlot | null

  if (!slot || !BRANDING_SLOTS.includes(slot)) throw new HttpError(400, 'VALIDATION_ERROR', `slot must be one of ${BRANDING_SLOTS.join(', ')}`)

  const declared = Number(req.headers.get('content-length') ?? 0)

  if (declared > MAX_IMAGE_BYTES[slot] + 16 * 1024) throw new HttpError(413, 'BRANDING_TOO_LARGE', `At most ${MAX_IMAGE_BYTES[slot] / 1024} KB`)

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')

  if (!file || typeof file === 'string') throw new HttpError(400, 'BRANDING_NO_FILE', 'Send the image as the multipart field "file"')
  if (file.size > MAX_IMAGE_BYTES[slot]) throw new HttpError(413, 'BRANDING_TOO_LARGE', `At most ${MAX_IMAGE_BYTES[slot] / 1024} KB`)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const asset = await storeUpload(bytes, slot)

  // The uploaded image as a data URL, for the screen's instant preview (`<img src={dataUrl}>`).
  // Only the reference above goes into the document; the site fetches the file by its hash.
  return ok({ ...asset, dataUrl: `data:${asset.type};base64,${Buffer.from(bytes).toString('base64')}` })
})

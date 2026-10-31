import 'server-only'

import { createHash } from 'node:crypto'

import { HttpError } from '@/lib/owner/guard'
import { ownerApi, ownerJson } from './backend'
import { ASSET_FILE_RE, inspectBrandingImage, type BrandingAsset, type BrandingSlot } from './branding'

/**
 * The uploaded branding images, stored by the site backend in `owner_branding_assets`
 * (`PUT <gateway>/api/v1/admin/owner/branding/asset/<sha256>.<ext>`), never on this host's disk.
 * An upload only stores the image; it is in use once a save names it. The backend re-checks the
 * bytes against the name and the image rules, and keeps every version's images (no delete).
 */
export const CONTENT_TYPE: Record<string, string> = { png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' }

export async function storeUpload(bytes: Uint8Array, slot: BrandingSlot): Promise<BrandingAsset> {
  const image = inspectBrandingImage(bytes, slot)

  if (!image.ok) throw new HttpError(image.code === 'TOO_LARGE' ? 413 : image.code === 'NO_FILE' ? 400 : 422, `BRANDING_${image.code}`, image.reason)

  const hash = createHash('sha256').update(image.data).digest('hex')
  const file = `${hash}.${image.ext}`

  await ownerJson(`/branding/asset/${file}?slot=${slot}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Uint8Array(image.data)
  })

  return {
    file,
    type: image.type,
    bytes: image.data.length,
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {})
  }
}

export async function assetExists(file: string) {
  return ASSET_FILE_RE.test(file) && (await ownerApi(`/branding/asset/${file}`, { method: 'HEAD' })).ok
}

/** The bytes of a stored image, re-hashed: an answer whose content does not match its name is not served. */
export async function readAsset(file: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (!ASSET_FILE_RE.test(file)) return null
  const res = await ownerApi(`/branding/asset/${file}`)

  if (!res.ok) return null
  const data = Buffer.from(await res.arrayBuffer())

  if (createHash('sha256').update(data).digest('hex') !== file.split('.')[0]) return null

  return { data, contentType: CONTENT_TYPE[file.split('.')[1]] }
}

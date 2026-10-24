import 'server-only'

/** An image answer that stays an inert picture even when opened directly (an SVG cannot run anything). */
export function imageResponse(asset: { data: Buffer; contentType: string }) {
  return new Response(new Uint8Array(asset.data), {
    headers: {
      'content-type': asset.contentType,
      'content-length': String(asset.data.length),
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    }
  })
}

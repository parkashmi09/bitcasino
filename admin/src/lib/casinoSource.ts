// The admin never names the casino vendor or aggregator behind a feed (skill admin-no-vendor-names).
export const CASINO_SOURCE_LABEL: Record<string, string> = {
  inhouse: 'Originals',
  og: 'Original Games',
  gis: 'Casino feed 1',
  jsgames: 'Casino feed 2',
  jsgamesv2: 'Casino feed 2',
  seamless: 'Casino feed 3'
}

export const casinoSourceLabel = (source?: string | null) => (source ? (CASINO_SOURCE_LABEL[source] ?? 'Casino') : '—')

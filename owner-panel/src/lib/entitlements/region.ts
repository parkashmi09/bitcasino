/**
 * Region restriction (contract §2, docs/region-restriction.md): the document's `region`.
 * The MODE is the `region_restriction` policy's variant (none = Off, notice, block); this file
 * holds the list type and the countries. Mirrors backend/packages/common/src/regionPolicy.js
 * (scripts/region.test.mjs asserts the two lists match). No '@/' imports: the tests load it as is.
 */

export type RegionListType = 'blocklist' | 'allowlist'
export type RegionSetting = { listType: RegionListType; countries: string[] }

export const REGION_FEATURE = 'region_restriction'

export const LIST_TYPES: { key: RegionListType; label: string; description: string }[] = [
  { key: 'blocklist', label: 'Blocklist', description: 'The countries listed are restricted. The default.' },
  { key: 'allowlist', label: 'Allowlist', description: 'Only the countries listed are allowed; every other country is restricted.' }
]

/** Every ISO 3166-1 alpha-2 code (249) plus XK (Kosovo, what GeoIP databases answer). */
export const COUNTRY_CODES: string[] = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE',
  'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD',
  'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
  'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
  'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME',
  'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
  'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI',
  'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK',
  'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'XK', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
]

const CODES = new Set(COUNTRY_CODES)

export const isCountryCode = (code: unknown): code is string => typeof code === 'string' && CODES.has(code)

export const DEFAULT_REGION: RegionSetting = { listType: 'blocklist', countries: [] }

/** Reading: known list type, known codes, upper-case, unique, sorted; anything else dropped. */
export function cleanRegion(value: unknown): RegionSetting {
  const given = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as { listType?: unknown; countries?: unknown }
  const listType: RegionListType = given.listType === 'allowlist' ? 'allowlist' : 'blocklist'

  const countries = Array.isArray(given.countries)
    ? [...new Set(given.countries.filter((c): c is string => typeof c === 'string').map(c => c.trim().toUpperCase()).filter(isCountryCode))].sort()
    : []

  return { listType, countries }
}

/** Saving (strict): the first problem with a submitted region, or null. Codes must be exact (upper-case). */
export function regionProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'region must be an object { listType, countries }'
  const { listType, countries, ...rest } = value as { listType?: unknown; countries?: unknown }

  if (Object.keys(rest).length) return `region.${Object.keys(rest)[0]} is not a field (listType, countries)`
  if (listType !== 'blocklist' && listType !== 'allowlist') return 'region.listType must be blocklist or allowlist'
  if (!Array.isArray(countries)) return 'region.countries must be a list of ISO 3166-1 alpha-2 codes'
  if (countries.length > COUNTRY_CODES.length) return 'region.countries has too many entries'
  const bad = countries.filter(c => !isCountryCode(c))

  if (bad.length) return `region.countries: ${bad.slice(0, 5).map(c => JSON.stringify(c)).join(', ')} not ISO 3166-1 alpha-2 (upper-case, e.g. US, GB)`

  return null
}

/** "us, gb de" typed by the owner → ["US", "GB", "DE"]. Validation is regionProblem's. */
export const parseCountries = (text: string) => [...new Set(text.split(/[\s,;]+/).map(c => c.trim().toUpperCase()).filter(Boolean))]

export const regionLabel = (r: RegionSetting | null | undefined) =>
  r ? `${r.listType === 'allowlist' ? 'Allowlist' : 'Blocklist'}: ${r.countries.length ? r.countries.join(', ') : 'no countries'}` : '—'

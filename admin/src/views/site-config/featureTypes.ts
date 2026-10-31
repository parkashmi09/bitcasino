export type Field = { key: string; label: string; required?: boolean; pattern?: string; placeholder?: string }

export type Variant = {
  key: string
  label: string
  description: string
  configFields: Field[]
  secretFields: Field[]
}

export type CatalogueFeature = {
  key: string
  label: string
  category: string

  /** `policy` — always in force, no switch; its "off" is the `none` variant. */
  kind: 'feature' | 'policy'
  defaultVariant: string
  flag: string | null
  variants: Variant[]
}

export type Template = { key: string; label: string; description: string; variants: Record<string, string> }

export type Catalogue = { features: CatalogueFeature[]; templates: Template[] }

export type SiteFeature = {
  feature: string
  label: string
  category: string
  kind: 'feature' | 'policy'

  /** Region restriction only: the platform's list type and countries (read-only here). */
  region?: { listType: 'blocklist' | 'allowlist'; countries: string[] }

  /** Withdrawal requirements only: the platform's deposit cap (read-only here). */
  withdrawalCap?: { enabled: boolean; depositMultiplier: number; wagerBonus: boolean; wagerMultiplier: number }

  /** Withdrawal requirements only: the platform's daily limit per currency, rolling 24 hours (read-only here). */
  withdrawalDailyLimit?: { enabled: boolean; limits: Record<string, string> }

  /** Nothing stored — reading the permissive default. */
  isDefault: boolean
  flag: string | null
  enabled: boolean
  variant: string
  variantLabel: string
  config: Record<string, string>
  secretsSet: Record<string, boolean>
  updatedBy: string | null
  updatedAt: string | null

  /** False when the owner left this feature out of the site's plan. Older backends omit it (= entitled). */
  entitled?: boolean
}

/** The template the platform set. Newer backends send `{ key, label }`; older ones a bare key. */
export type ActiveTemplate = { key: string; label?: string; description?: string }

export type SiteFeatures = {
  template: string | ActiveTemplate | null
  features: SiteFeature[]

  /** `'owner'`: every variant and on/off is set from the owner panel; staff only read it. Older backends omit it. */
  managedBy?: 'owner'
}

/** What staff are told when they ask to change a feature the platform manages. */
export const OWNER_MANAGED_MESSAGE = 'Features are managed by the platform. Contact support to change them.'

export type FeaturesResponse = { catalogue: Catalogue; current: SiteFeatures }

export const CATEGORY_LABELS: Record<string, string> = {
  business: 'Business & payments',
  engagement: 'Engagement',
  wallet: 'Wallet',
  casino: 'Casino',
  content: 'Content',
  integration: 'Integrations'
}

export const CATEGORY_ORDER = ['business', 'engagement', 'wallet', 'casino', 'content', 'integration']

/**
 * Templates carry generic colour-theme names. These are the fallbacks for a backend that still
 * sends the old keys, labels or descriptions, so staff never see a reference-site name.
 */
export const TEMPLATE_FALLBACK: Record<string, { label: string; description: string }> = {
  carbon_gold: {
    label: 'Carbon Gold',
    description: 'Carbon Gold: races, spin wheel, gift cards, chat with presence, term-lock vault, category blog.'
  },
  violet_night: {
    label: 'Violet Night',
    description: 
      'Violet Night: VIP program page, promotions tile grid, weekly race, flat vault, token lottery, KYC status in settings.'
  },
  emerald_dark: {
    label: 'Emerald Dark',
    description: 
      'Emerald Dark: 34-level VIP club, reward hub, quest hub, ticket raffle, drawer chat, full swap page, an external blog link.'
  },
  neon_navy: {
    label: 'Neon Navy',
    description: 
      'Neon Navy: 75-level VIP ladder, spin wheel, gift cards, bonus centre, affiliate, wallet swap and category blog; no races, chat or vault.'
  }
}

/** Old template keys still stored on some sites → their generic key. */
export const LEGACY_TEMPLATES: Record<string, string> = {
  stake: 'carbon_gold',
  shuffle: 'violet_night',
  bcgame: 'emerald_dark',
  addaplay: 'neon_navy'
}

export const resolveTemplateKey = (key: string) => LEGACY_TEMPLATES[key] ?? key

/** Any reference-site name a label or description must never show. */
const BRAND_NAME = /stake|shuffle|bc\.?game|hash-games|addaplay/i

/** The active template as staff see it: generic key, label and description, or null when none is set. */
export function describeTemplate(
  raw: SiteFeatures['template'] | undefined,
  templates: Template[] = []
): { key: string; label: string; description: string } | null {
  if (!raw) return null
  const given = typeof raw === 'string' ? { key: raw } : raw
  const key = resolveTemplateKey(given.key)
  const listed = templates.find(t => resolveTemplateKey(t.key) === key)
  const fallback = TEMPLATE_FALLBACK[key]
  const clean = (v?: string) => (v && !BRAND_NAME.test(v) ? v : undefined)

  return {
    key,
    label: clean(given.label) ?? clean(listed?.label) ?? fallback?.label ?? 'Custom',
    description: clean(given.description) ?? clean(listed?.description) ?? fallback?.description ?? ''
  }
}

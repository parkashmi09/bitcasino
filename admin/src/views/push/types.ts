/** Shapes of the staff push routes (`admin/push/*`, backend modules/push). */

export type PushStatus = {
  entitled: boolean
  enabled: boolean
  variant: string
  appIdSet: boolean
  appId: string | null
  apiKeySet: boolean
  ready: boolean
  sdkReady: boolean
  publicOrigin: string | null
  publicOriginSource: string | null
  imagesFetchable: boolean
  allSegment: string
  whereToSet: { variant: string; appId: string; apiKey: string }
  image: { maxBytes: number; recommended: { width: number; height: number; ratio: number }; formats: string[] }
}

export type PushButton = { id: string; text: string; url?: string | null; icon?: string | null }

export type TagFilter = { tag: string; relation: string; value?: string | null }

export type Audience =
  | { kind: 'all' }
  | { kind: 'players'; userIds: number[] }
  | { kind: 'segment'; segments: string[] }
  | { kind: 'filters'; filters: TagFilter[]; match: 'all' | 'any' }

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'

export type Campaign = {
  id: number
  name: string | null
  title: string
  body: string
  imageUrl: string | null
  iconUrl: string | null
  badgeUrl: string | null
  url: string | null
  buttons: PushButton[]
  data: Record<string, string | number | boolean> | null
  priority: 'normal' | 'high'
  ttlSeconds: number | null
  topic: string | null
  audience: Audience
  inbox: boolean
  status: CampaignStatus
  sendAt: string | null
  sentAt: string | null
  cancelledAt: string | null
  onesignalIds: string[]
  recipients: number
  accepted: number
  inboxRows: number
  error: string | null
  createdBy: number | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
  warnings?: string[]
}

export type PreviewResult = {
  payload: Record<string, unknown>
  audience: { kind: string; players: number | null; skipped: number; inbox: boolean; oneSignalTarget: string }
  warnings: string[]
}

export type TestResult = {
  accepted: number
  notificationIds: string[]
  failures: string[]
  warnings: string[]
  hint: string | null
}

export type UploadedImage = {
  id: number
  path: string
  url: string
  contentType: string
  byteSize: number
  width: number | null
  height: number | null
  warnings: string[]
}

export type PushTemplate = {
  kind: string
  group: string
  label: string
  placeholders: string[]
  defaults: { title: string; body: string; url: string }
  customised: boolean
  enabled: boolean
  title: string
  body: string
  imageUrl: string | null
  url: string | null
  updatedAt: string | null
  warnings?: string[]
}

export type PromptSettings = {
  enabled: boolean
  title: string
  text: string
  allowLabel: string
  laterLabel: string
  trigger: 'after_login' | 'after_first_deposit'
  delaySeconds: number
  cooldownDays: number
}

export type PushSettings = {
  prompt: PromptSettings
  publicOrigin: string
  allSegment: string
  defaultIconUrl: string
}

/** OneSignal's tag relations (backend TAG_RELATIONS). */
export const TAG_RELATIONS = ['=', '!=', '>', '<', 'exists', 'not_exists', 'time_elapsed_gt', 'time_elapsed_lt'] as const

/** Tags the player site sets on every subscriber. */
export const KNOWN_TAGS = ['vip_level', 'language', 'currency', 'country'] as const

/** `/api/v1/admin/push/images/x.png` (absolute or not) → the admin proxy URL, so the preview loads even when the public origin is not reachable from here. */
export const imageSrc = (url: string | null | undefined): string | null => {
  if (!url) return null
  const m = /\/api\/v1\/(admin\/push\/images\/[^?#]+)/.exec(url)

  return m ? `/api/gw/api/v1/${m[1]}` : url
}

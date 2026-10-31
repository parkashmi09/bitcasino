import { ApiError } from '@/lib/api/client'

/**
 * Client-side form checks. A form builds a `FieldErrors` map keyed by the
 * field's `name` (or its `id` when it has no name); a falsy value means "ok".
 * `FormDialog validate={...}` shows each message under its field and blocks
 * the submit; server 422 `details.fields` land on the same keys.
 */
export type FieldErrors = Record<string, string | false | null | undefined>

type Value = string | number | null | undefined

const text = (v: Value) => (v === null || v === undefined ? '' : String(v)).trim()

/** Only the keys that actually carry a message. */
export const cleanErrors = (errors: FieldErrors | null | undefined): Record<string, string> => {
  const out: Record<string, string> = {}

  for (const [k, msg] of Object.entries(errors ?? {})) if (msg) out[k] = msg

  return out
}

export const hasErrors = (errors: FieldErrors | null | undefined) => Object.keys(cleanErrors(errors)).length > 0

export const firstError = (errors: FieldErrors | null | undefined) => Object.values(cleanErrors(errors))[0]

type NumberRule = {

  /** Inclusive lower bound (default: none). */
  min?: number

  /** Inclusive upper bound. */
  max?: number

  /** Strictly greater than zero. */
  positive?: boolean

  /** Whole numbers only. */
  integer?: boolean

  /** Max decimal places. */
  decimals?: number

  /** Empty is fine (the field is optional). */
  optional?: boolean
}

export const check = {
  required: (v: Value, label: string) => (text(v) ? undefined : `${label} is required`),

  /** A number typed as text (amounts are decimal strings on the wire). */
  number: (v: Value, label: string, rule: NumberRule = {}) => {
    const s = text(v)

    if (!s) return rule.optional ? undefined : `${label} is required`
    if (!/^-?\d+(\.\d+)?$/.test(s)) return `${label} must be a number`
    const n = Number(s)

    if (!Number.isFinite(n)) return `${label} must be a number`
    if (rule.integer && !Number.isInteger(n)) return `${label} must be a whole number`
    if (rule.positive && n <= 0) return `${label} must be greater than 0`
    if (rule.min !== undefined && n < rule.min) return `${label} must be at least ${rule.min}`
    if (rule.max !== undefined && n > rule.max) return `${label} must be at most ${rule.max}`

    if (rule.decimals !== undefined) {
      const places = s.split('.')[1]?.length ?? 0

      if (places > rule.decimals) return rule.decimals === 0 ? `${label} must be a whole number` : `${label} allows at most ${rule.decimals} decimal places`
    }

    return undefined
  },

  /** Shorthand: a money amount > 0. */
  amount: (v: Value, label = 'Amount', rule: Omit<NumberRule, 'positive'> = {}) => check.number(v, label, { decimals: 8, ...rule, positive: rule.min === undefined }),

  /** A positive integer id (user id, game id…). */
  id: (v: Value, label: string, optional = false) => check.number(v, label, { integer: true, positive: true, optional }),

  length: (v: Value, label: string, { min, max }: { min?: number; max?: number }) => {
    const s = text(v)

    if (min !== undefined && s.length < min) return `${label} must be at least ${min} characters`
    if (max !== undefined && s.length > max) return `${label} must be at most ${max} characters`

    return undefined
  },

  email: (v: Value, label = 'Email', optional = false) => {
    const s = text(v)

    if (!s) return optional ? undefined : `${label} is required`

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? undefined : `${label} must be a valid email address`
  },

  url: (v: Value, label = 'URL', optional = false) => {
    const s = text(v)

    if (!s) return optional ? undefined : `${label} is required`

    try {
      const u = new URL(s)

      return u.protocol === 'http:' || u.protocol === 'https:' ? undefined : `${label} must start with http:// or https://`
    } catch {
      return `${label} must be a valid URL (https://…)`
    }
  },

  /** The platform's staff password rule (packages/common validate.js `password()`). */
  password: (v: Value, label = 'Password', minLength = 8) => {
    const s = v === null || v === undefined ? '' : String(v)

    if (!s) return `${label} is required`
    if (s.length < minLength) return `${label} must be at least ${minLength} characters`
    if (s.length > 128) return `${label} must be at most 128 characters`
    if (!/[a-z]/.test(s)) return `${label} must contain a lowercase letter`
    if (!/[A-Z]/.test(s)) return `${label} must contain an uppercase letter`
    if (!/[0-9]/.test(s)) return `${label} must contain a number`

    return undefined
  },

  match: (a: Value, b: Value, message = 'The two values do not match') => (text(a) && text(a) !== text(b) ? message : undefined),

  /** `from` must not be after `to` (ISO date or datetime strings). */
  dateRange: (from: Value, to: Value, message = 'Start must be before the end') => {
    const f = text(from)
    const t = text(to)

    if (!f || !t) return undefined

    return new Date(f).getTime() > new Date(t).getTime() ? message : undefined
  }
}

/** Server 422 `details.fields` → `{ amount: 'amount must be greater than zero' }`. */
export const serverFieldErrors = (error: unknown): Record<string, string> => {
  const out: Record<string, string> = {}

  if (!(error instanceof ApiError)) return out
  const list = error.details?.fields ?? error.details?.issues ?? error.details?.errors

  if (!Array.isArray(list)) return out

  for (const item of list as { field?: unknown; path?: unknown; message?: unknown }[]) {
    const raw = typeof item.field === 'string' ? item.field : Array.isArray(item.path) ? item.path.join('.') : typeof item.path === 'string' ? item.path : ''
    const key = raw.replace(/^(body|query|params)\./, '')

    if (key && typeof item.message === 'string' && !out[key]) out[key] = item.message
  }

  return out
}

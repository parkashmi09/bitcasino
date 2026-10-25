/**
 * Payment gateway deposit methods per currency — the document's `paymentMethods` block:
 *
 *   { f2pay: { INR: [{ code: 'UpiMixed', active: true }] } }
 *
 * The owner's methods for each gateway currency; the site writes them into its `payment_methods`
 * table (owner_enabled = active) next to the ones the Super Admin adds. A method the owner has
 * inactive is off on the site whatever the Super Admin does. Absent = {} (the owner lists none).
 *
 * Mirrors backend/packages/common/src/paymentMethods.js. No '@/' imports: the tests load it as is.
 */

export type PaymentMethod = { code: string; active: boolean }
export type PaymentMethods = Record<string, Record<string, PaymentMethod[]>>

export const DEFAULT_PAYMENT_METHODS: PaymentMethods = {}

export const MAX_METHODS_PER_CURRENCY = 50

const GATEWAY_RE = /^[a-z0-9_]{2,30}$/
const CURRENCY_RE = /^[A-Z][A-Z0-9]{1,9}$/
const CODE_RE = /^[A-Za-z0-9_]{1,40}$/

/** An F2Pay-style method code: letters, digits, underscore, case kept (UpiMixed). */
export const isMethodCode = (v: unknown) => typeof v === 'string' && CODE_RE.test(v)

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** Reading: a bad gateway, currency or method is dropped; the first of a repeated code wins. */
export function cleanPaymentMethods(value: unknown): PaymentMethods {
  const out: PaymentMethods = {}

  if (!isObject(value)) return out

  for (const [gateway, currencies] of Object.entries(value)) {
    if (!GATEWAY_RE.test(gateway) || !isObject(currencies)) continue

    for (const [currency, list] of Object.entries(currencies)) {
      if (!CURRENCY_RE.test(currency) || !Array.isArray(list)) continue
      const methods: PaymentMethod[] = []

      for (const m of list) {
        if (!isObject(m) || !isMethodCode(m.code) || typeof m.active !== 'boolean') continue
        if (methods.some(x => x.code === m.code) || methods.length >= MAX_METHODS_PER_CURRENCY) continue
        methods.push({ code: m.code as string, active: m.active })
      }

      out[gateway] = { ...out[gateway], [currency]: methods }
    }
  }

  return out
}

/** Saving (strict): the first problem with a submitted block, or null. */
export function paymentMethodsProblem(value: unknown): string | null {
  if (!isObject(value)) return 'paymentMethods must be an object of gateway → currency → methods'

  for (const [gateway, currencies] of Object.entries(value)) {
    if (!GATEWAY_RE.test(gateway)) return `paymentMethods: ${gateway} is not a gateway name (lower case, e.g. f2pay)`
    if (!isObject(currencies)) return `paymentMethods.${gateway} must be an object of currency → methods`

    for (const [currency, list] of Object.entries(currencies)) {
      if (!CURRENCY_RE.test(currency)) return `paymentMethods.${gateway}: ${currency} is not a currency code (upper case, e.g. INR)`
      if (!Array.isArray(list)) return `paymentMethods.${gateway}.${currency} must be a list of methods`
      if (list.length > MAX_METHODS_PER_CURRENCY) return `paymentMethods.${gateway}.${currency}: at most ${MAX_METHODS_PER_CURRENCY} methods`
      const seen = new Set<string>()

      for (const m of list) {
        if (!isObject(m) || Object.keys(m).some(k => k !== 'code' && k !== 'active')) {
          return `paymentMethods.${gateway}.${currency}: each method is { code, active }`
        }

        if (!isMethodCode(m.code)) return `paymentMethods.${gateway}.${currency}: ${String(m.code)} is not a method code (letters, digits, _)`
        if (typeof m.active !== 'boolean') return `paymentMethods.${gateway}.${currency}.${m.code}: active must be true or false`
        if (seen.has(m.code as string)) return `paymentMethods.${gateway}.${currency}: ${m.code} is listed twice`
        seen.add(m.code as string)
      }
    }
  }

  return null
}

/** "f2pay INR: UpiMixed · IDR: QRIS, DANA (off)" / "None". */
export function paymentMethodsLabel(p: PaymentMethods | null | undefined) {
  const rows = Object.entries(p ?? {}).flatMap(([gateway, currencies]) =>
    Object.entries(currencies).map(
      ([currency, list]) => `${gateway} ${currency}: ${list.length ? list.map(m => `${m.code}${m.active ? '' : ' (off)'}`).join(', ') : '—'}`
    )
  )

  return rows.length ? rows.join(' · ') : 'None'
}

/** The audit change for the block, compared cleaned (an older document = none), or null. */
export function diffPaymentMethods(before: unknown, after: unknown) {
  const from = cleanPaymentMethods(before)
  const to = cleanPaymentMethods(after)


  // Gateway and currency order does not matter; method order is the list's own.
  const key = (p: PaymentMethods) =>
    JSON.stringify(Object.entries(p).sort().map(([g, c]) => [g, Object.entries(c).sort()]))

  return key(from) === key(to) ? null : { kind: 'payment_methods' as const, key: 'paymentMethods' as const, from, to }
}

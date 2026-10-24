/**
 * Withdrawal requirements as switches (contract §2): KYC required, Wagering complete required,
 * Deposit cap — any combination.
 *
 * KYC and wagering are the `withdrawal_requirements` policy's VARIANT, exactly as before (none /
 * kyc / wager / kyc_and_wager are the four combinations of the two switches), so an older
 * document and an older backend keep working. The deposit cap is the document's `withdrawalCap`
 * block. Mirrors backend/packages/common/src/withdrawalCap.js (scripts/withdrawalCap.test.mjs
 * asserts they agree). No '@/' imports: the tests load it as is.
 */

export type WithdrawalCap = { enabled: boolean; depositMultiplier: number; wagerBonus: boolean; wagerMultiplier: number }

export const WITHDRAWAL_REQUIREMENTS = 'withdrawal_requirements'

export const DEFAULT_WITHDRAWAL_CAP: WithdrawalCap = { enabled: false, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 }

export const MAX_MULTIPLIER = 100

const FIELDS = ['enabled', 'depositMultiplier', 'wagerBonus', 'wagerMultiplier']

/** A positive number, at most 2 decimals, at most MAX_MULTIPLIER. */
export const isMultiplier = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_MULTIPLIER && Math.round(n * 100) === n * 100

/** Reading: known fields only; a missing or bad value is its default (an older document = cap off). */
export function cleanWithdrawalCap(value: unknown): WithdrawalCap {
  const given = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>

  return {
    enabled: typeof given.enabled === 'boolean' ? given.enabled : DEFAULT_WITHDRAWAL_CAP.enabled,
    depositMultiplier: isMultiplier(given.depositMultiplier) ? given.depositMultiplier : DEFAULT_WITHDRAWAL_CAP.depositMultiplier,
    wagerBonus: typeof given.wagerBonus === 'boolean' ? given.wagerBonus : DEFAULT_WITHDRAWAL_CAP.wagerBonus,
    wagerMultiplier: isMultiplier(given.wagerMultiplier) ? given.wagerMultiplier : DEFAULT_WITHDRAWAL_CAP.wagerMultiplier
  }
}

/** Saving (strict): the first problem with a submitted cap, or null. */
export function withdrawalCapProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'withdrawalCap must be an object'
  const v = value as Record<string, unknown>
  const extra = Object.keys(v).find(k => !FIELDS.includes(k))

  if (extra) return `withdrawalCap.${extra} is not a field (${FIELDS.join(', ')})`
  for (const k of ['enabled', 'wagerBonus']) if (typeof v[k] !== 'boolean') return `withdrawalCap.${k} must be true or false`

  for (const k of ['depositMultiplier', 'wagerMultiplier']) {
    if (!isMultiplier(v[k])) return `withdrawalCap.${k} must be a number above 0 and at most ${MAX_MULTIPLIER}, with at most 2 decimals`
  }

  return null
}

/** The policy variant → its two switches. An unknown variant reads as the default, kyc. */
export function switchesOf(variant: string | null | undefined): { kyc: boolean; wager: boolean } {
  switch (variant) {
    case 'none':
      return { kyc: false, wager: false }
    case 'wager':
      return { kyc: false, wager: true }
    case 'kyc_and_wager':
      return { kyc: true, wager: true }
    default:
      return { kyc: true, wager: false }
  }
}

/** The two switches → the policy variant the backend stores. */
export const variantOfSwitches = ({ kyc, wager }: { kyc: boolean; wager: boolean }) =>
  kyc && wager ? 'kyc_and_wager' : kyc ? 'kyc' : wager ? 'wager' : 'none'

/** "3× deposits + wagering up to 5×" / "Off". */
export const withdrawalCapLabel = (c: WithdrawalCap | null | undefined) =>
  !c || !c.enabled ? 'Off' : `${c.depositMultiplier}× deposits${c.wagerBonus ? ` + wagering up to ${c.wagerMultiplier}×` : ''}`

/** The audit change for the cap block, compared cleaned (an older document = the cap off), or null. */
export function diffWithdrawalCap(before: unknown, after: unknown) {
  const from = cleanWithdrawalCap(before)
  const to = cleanWithdrawalCap(after)

  return JSON.stringify(from) === JSON.stringify(to) ? null : { kind: 'withdrawal_cap' as const, key: 'withdrawalCap' as const, from, to }
}

/**
 * The owner screen's working copy: the loaded document plus the owner's edits. With no edits the
 * draft IS the document, so a fresh load lists no changes and saving it changes nothing.
 */
import type { RegionSetting } from './region'
import type { WithdrawalCap } from './withdrawalCap'
import type { WithdrawalDailyLimit } from './withdrawalDailyLimit'
import type { PaymentMethods } from './paymentMethods'

export type Draft = {
  region?: RegionSetting
  withdrawalCap?: WithdrawalCap
  withdrawalDailyLimit?: WithdrawalDailyLimit
  paymentMethods?: PaymentMethods
  withdrawalsEnabled?: boolean
  template?: string
  features: Record<string, boolean>
  flags: Record<string, boolean>
  variants: Record<string, string>
  options: Record<string, Record<string, boolean>>
}

type Loaded = {
  region?: RegionSetting
  withdrawalCap?: WithdrawalCap
  withdrawalDailyLimit?: WithdrawalDailyLimit
  paymentMethods?: PaymentMethods
  withdrawalsEnabled?: boolean
  template: string
  features: Record<string, boolean>
  flags: Record<string, boolean>
  variants: Record<string, string>
  options: Record<string, Record<string, boolean>>
}

export function buildDraft(doc: Loaded, edits: Partial<Draft> | null): Draft {
  return {
    template: edits?.template ?? doc.template,
    features: { ...doc.features, ...edits?.features },
    flags: { ...doc.flags, ...edits?.flags },
    variants: { ...doc.variants, ...edits?.variants },
    options: Object.fromEntries(Object.entries(doc.options).map(([f, v]) => [f, { ...v, ...edits?.options?.[f] }])),
    ...(edits?.region ?? doc.region ? { region: edits?.region ?? doc.region } : {}),
    ...(edits?.withdrawalCap ?? doc.withdrawalCap ? { withdrawalCap: edits?.withdrawalCap ?? doc.withdrawalCap } : {}),
    ...(edits?.withdrawalDailyLimit ?? doc.withdrawalDailyLimit
      ? { withdrawalDailyLimit: edits?.withdrawalDailyLimit ?? doc.withdrawalDailyLimit }
      : {}),
    ...(edits?.paymentMethods ?? doc.paymentMethods ? { paymentMethods: edits?.paymentMethods ?? doc.paymentMethods } : {}),
    ...((edits?.withdrawalsEnabled ?? doc.withdrawalsEnabled) !== undefined
      ? { withdrawalsEnabled: edits?.withdrawalsEnabled ?? doc.withdrawalsEnabled }
      : {})
  }
}

/**
 * Whether a variant dropdown change came from the owner picking an option in the open list.
 * Base UI's Select also changes its value with reason `none` when its hidden input is filled by the
 * browser (autofill / form restore) and on type-ahead over a CLOSED, focused trigger — e.g. two
 * stray "o" keys over "OneSignal" select "Off". Neither is a deliberate choice, and on this screen
 * one would silently switch a feature off, so only an item press counts.
 */
export const isOwnerPick = (reason: string | undefined) => reason === 'item-press'

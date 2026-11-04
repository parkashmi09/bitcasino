'use client'

import { Checkbox } from '@/components/ui/checkbox'

import { GATEWAYS, type Gateway, type Plan } from './types'

const PRODUCTS: { key: keyof Plan['products']; label: string; hint: string }[] = [
  { key: 'casino', label: 'Casino', hint: 'Slotegrator slots and live casino, run through this site.' },
  { key: 'sports', label: 'Sports', hint: 'Sports exchange and sportsbook, on the shared feed.' },
  { key: 'originals', label: 'Original games', hint: 'Crash, mines, dice and the other originals, run through this site.' }
]

const FEATURES: { key: keyof Plan['features']; label: string; hint: string }[] = [
  { key: 'branch_management', label: 'Branch management', hint: 'The company creates branches with their own logins.' },
  { key: 'bonus', label: 'Bonus', hint: 'Deposit bonuses and the reward hub.' },
  { key: 'affiliate', label: 'Affiliate', hint: 'Player referrals and commissions.' },
  { key: 'vip', label: 'VIP club', hint: 'VIP levels and their rewards.' },
  { key: 'promotions', label: 'Promotions', hint: 'The promotions page.' }
]

export const GATEWAY_LABELS: Record<Gateway, string> = {
  ccpayment: 'CCPayment (crypto)',
  f2pay: 'F2Pay (INR + crypto)',
  upi: 'UPI (EkQR)'
}

/** Nothing chosen: the Super Admin picks every product and feature on purpose. */
export const EMPTY_PLAN: Plan = {
  products: { casino: false, sports: false, originals: false },
  features: { branch_management: false, bonus: false, affiliate: false, vip: false, promotions: false },
  payments: { manual: false, gateways: { ccpayment: false, f2pay: false, upi: false } }
}

export const planError = (plan: Plan) =>
  !Object.values(plan.products).some(Boolean)
    ? 'Choose at least one product: Casino, Sports or Original games'
    : !plan.payments.manual && !Object.values(plan.payments.gateways).some(Boolean)
      ? 'Choose manual payments, a payment gateway or both'
      : ''

type Group = 'products' | 'features' | 'payments'

type Props = { value: Plan; onChange: (plan: Plan) => void; disabled?: boolean; groups?: Group[] }

/** The products (at least one) and features a whitelabel runs; everything left out is off on the copy. */
const PlanPicker = ({ value, onChange, disabled, groups = ['products', 'features', 'payments'] }: Props) => {
  const option = <G extends 'products' | 'features'>(group: G, key: string, label: string, hint: string) => (
    <label key={key} className='flex items-start gap-3 rounded-md border p-3'>
      <Checkbox
        className='mt-0.5'
        disabled={disabled}
        checked={(value[group] as Record<string, boolean>)[key]}
        onCheckedChange={c => onChange({ ...value, [group]: { ...value[group], [key]: c === true } })}
      />
      <span className='grid gap-0.5'>
        <span className='text-sm font-medium'>{label}</span>
        <span className='text-muted-foreground text-xs'>{hint}</span>
      </span>
    </label>
  )

  // `gateway` null = manual payments.
  const payment = (gateway: Gateway | null, label: string, hint: string) => (
    <label key={gateway ?? 'manual'} className='flex items-start gap-3 rounded-md border p-3'>
      <Checkbox
        className='mt-0.5'
        disabled={disabled}
        checked={gateway ? value.payments.gateways[gateway] : value.payments.manual}
        onCheckedChange={c =>
          onChange({
            ...value,
            payments: gateway
              ? { ...value.payments, gateways: { ...value.payments.gateways, [gateway]: c === true } }
              : { ...value.payments, manual: c === true }
          })
        }
      />
      <span className='grid gap-0.5'>
        <span className='text-sm font-medium'>{label}</span>
        <span className='text-muted-foreground text-xs'>{hint}</span>
      </span>
    </label>
  )

  return (
    <div className='grid gap-4'>
      {groups.includes('products') && (
        <div className='grid gap-2'>
          <span className='text-sm font-medium'>Products (at least one)</span>
          <div className='grid gap-2 sm:grid-cols-3'>{PRODUCTS.map(p => option('products', p.key, p.label, p.hint))}</div>
        </div>
      )}
      {groups.includes('features') && (
        <div className='grid gap-2'>
          <span className='text-sm font-medium'>Features</span>
          <div className='grid gap-2 sm:grid-cols-3'>{FEATURES.map(f => option('features', f.key, f.label, f.hint))}</div>
        </div>
      )}
      {groups.includes('payments') && (
      <div className='grid gap-2'>
        <span className='text-sm font-medium'>Payments (manual, a gateway or both)</span>
        <div className='grid gap-2 sm:grid-cols-3'>
          {payment(null, 'Manual payments', 'Bank / UPI transfer with a reference; the company approves. No charge.')}
          {GATEWAYS.map(g => payment(g, GATEWAY_LABELS[g], 'Runs on your gateway account; charged per the rates below.'))}
        </div>
      </div>
      )}
    </div>
  )
}

export default PlanPicker

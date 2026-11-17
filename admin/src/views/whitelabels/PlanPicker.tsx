'use client'

import { Checkbox } from '@/components/ui/checkbox'

import { GATEWAYS, type BusinessModel, type Gateway, type Plan } from './types'

export const MODELS: { key: BusinessModel; label: string; hint: string }[] = [
  { key: 'b2c', label: 'B2C — direct players', hint: 'Players sign up themselves and use the cashier. Promotions available. No agent network.' },
  { key: 'b2b', label: 'B2B — agent network', hint: 'No public sign-up. The company creates agents; agents create and fund players. No promotions or player cashier.' },
  { key: 'hybrid', label: 'Both', hint: 'Public sign-up and the agent network together.' }
]

/** Not offered on a B2B site: it has no promotions for anybody. */
const PROMOTION_FEATURES = new Set<keyof Plan['features']>(['bonus', 'affiliate', 'vip', 'promotions'])

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
  !plan.model
    ? 'Choose the business model: B2C, B2B or both'
    : !Object.values(plan.products).some(Boolean)
      ? 'Choose at least one product: Casino, Sports or Original games'
      : plan.model !== 'b2b' && !plan.payments.manual && !Object.values(plan.payments.gateways).some(Boolean)
        ? 'Choose manual payments, a payment gateway or both'
        : ''

/** Switching to B2B clears what a B2B site cannot run (the backend forces the same). */
export const withModel = (plan: Plan, model: BusinessModel): Plan =>
  model !== 'b2b'
    ? { ...plan, model }
    : {
        ...plan,
        model,
        features: Object.fromEntries(Object.entries(plan.features).map(([k, v]) => [k, PROMOTION_FEATURES.has(k as keyof Plan['features']) ? false : v])) as Plan['features'],
        payments: { manual: false, gateways: { ccpayment: false, f2pay: false, upi: false } }
      }

type Group = 'model' | 'products' | 'features' | 'payments'

type Props = { value: Plan; onChange: (plan: Plan) => void; disabled?: boolean; groups?: Group[] }

/** The products (at least one) and features a whitelabel runs; everything left out is off on the copy. */
const PlanPicker = ({ value, onChange, disabled, groups = ['model', 'products', 'features', 'payments'] }: Props) => {
  const b2b = value.model === 'b2b'

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
      {groups.includes('model') && (
        <div className='grid gap-2' role='radiogroup' aria-label='Business model'>
          <span className='text-sm font-medium'>Business model</span>
          <div className='grid gap-2 sm:grid-cols-3'>
            {MODELS.map(m => (
              <label
                key={m.key}
                className={`flex items-start gap-3 rounded-md border p-3 ${value.model === m.key ? 'border-primary bg-primary/5' : ''}`}
              >
                <input
                  type='radio'
                  name='business-model'
                  className='accent-primary mt-1'
                  disabled={disabled}
                  checked={value.model === m.key}
                  onChange={() => onChange(withModel(value, m.key))}
                />
                <span className='grid gap-0.5'>
                  <span className='text-sm font-medium'>{m.label}</span>
                  <span className='text-muted-foreground text-xs'>{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      {groups.includes('products') && (
        <div className='grid gap-2'>
          <span className='text-sm font-medium'>Products (at least one)</span>
          <div className='grid gap-2 sm:grid-cols-3'>{PRODUCTS.map(p => option('products', p.key, p.label, p.hint))}</div>
        </div>
      )}
      {groups.includes('features') && (
        <div className='grid gap-2'>
          <span className='text-sm font-medium'>Features</span>
          <div className='grid gap-2 sm:grid-cols-3'>
            {FEATURES.filter(f => !b2b || !PROMOTION_FEATURES.has(f.key)).map(f => option('features', f.key, f.label, f.hint))}
          </div>
          {b2b && <span className='text-muted-foreground text-xs'>Bonus, affiliate, VIP and promotions are not offered on a B2B site.</span>}
        </div>
      )}
      {groups.includes('payments') && b2b && (
        <p className='text-muted-foreground text-sm'>
          B2B: no player deposits or withdrawals. Agents fund and pay out their players, so there is nothing to choose here.
        </p>
      )}
      {groups.includes('payments') && !b2b && (
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

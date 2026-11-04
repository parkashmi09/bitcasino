'use client'

import { Input } from '@/components/ui/input'

import { GATEWAY_LABELS } from './PlanPicker'
import { GATEWAYS, type Plan, type Product, type Terms } from './types'

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/

const PRODUCT_LABELS: Record<Product, string> = { casino: 'Casino', sports: 'Sports', originals: 'Original games' }

export const ZERO_TERMS: Terms = {
  fees: Object.fromEntries(GATEWAYS.map(g => [g, { deposit: '0', withdraw: '0' }])) as Terms['fees'],
  revenueShare: { casino: '0', sports: '0', originals: '0' }
}

const percentOk = (v: string) => PERCENT.test(v) && Number(v) <= 100

export const termsError = (terms: Terms) =>
  [...Object.values(terms.fees).flatMap(f => [f.deposit, f.withdraw]), ...Object.values(terms.revenueShare)].every(percentOk)
    ? ''
    : 'Every rate is a percentage from 0 to 100 with at most 2 decimals'

type Props = { value: Terms; onChange: (terms: Terms) => void; plan: Plan; parts?: ('fees' | 'share')[] }

/**
 * Gateway charges (every gateway; one the plan leaves out is greyed and takes no orders) and the
 * GGR revenue share (every product, greyed the same way). Always shown, so nothing is hidden
 * behind a tick. The worked example uses the first chosen gateway's rates.
 */
const TermsEditor = ({ value, onChange, plan, parts = ['fees', 'share'] }: Props) => {
  const products = Object.keys(PRODUCT_LABELS) as Product[]

  const rate = (current: string, set: (v: string) => void, label: string, off: boolean) => (
    <label className={`grid gap-1 ${off ? 'opacity-50' : ''}`}>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <div className='flex items-center gap-1'>
        <Input inputMode='decimal' value={current} aria-invalid={!percentOk(current)} onChange={e => set(e.target.value.trim())} className='w-24' />
        <span className='text-sm'>%</span>
      </div>
    </label>
  )

  const first = GATEWAYS.find(g => plan.payments.gateways[g])
  const example = first ? value.fees[first] : null

  return (
    <div className='grid gap-6'>
      {parts.includes('fees') && (
        <div className='grid gap-3'>
          <span className='text-sm font-medium'>Gateway charges (taken from the company balance)</span>
          {GATEWAYS.map(g => {
            const off = !plan.payments.gateways[g]

            return (
              <div key={g} className='flex flex-wrap items-end gap-4'>
                <span className={`w-44 text-sm ${off ? 'text-muted-foreground' : ''}`}>
                  {GATEWAY_LABELS[g]}
                  {off && <span className='block text-xs'>not chosen above</span>}
                </span>
                {rate(value.fees[g].deposit, v => onChange({ ...value, fees: { ...value.fees, [g]: { ...value.fees[g], deposit: v } } }), 'Deposit charge', off)}
                {rate(value.fees[g].withdraw, v => onChange({ ...value, fees: { ...value.fees, [g]: { ...value.fees[g], withdraw: v } } }), 'Withdrawal charge', off)}
              </div>
            )
          })}
          {example && first && percentOk(example.deposit) && percentOk(example.withdraw) ? (
            <span className='text-muted-foreground text-xs'>
              Example: a player deposits 10,000 by {GATEWAY_LABELS[first]} → the company balance goes up by{' '}
              {(10000 * (1 - Number(example.deposit) / 100)).toLocaleString('en-IN')}. A 10,000 withdrawal takes{' '}
              {(10000 * (1 + Number(example.withdraw) / 100)).toLocaleString('en-IN')}. Manual payments are never charged.
            </span>
          ) : (
            <span className='text-muted-foreground text-xs'>Tick a gateway above to offer it. Manual payments are never charged.</span>
          )}
        </div>
      )}
      {parts.includes('share') && (
        <div className='grid gap-3'>
          <span className='text-sm font-medium'>GGR revenue share per product (reported, not collected)</span>
          <div className='flex flex-wrap gap-6'>
            {products.map(p => (
              <div key={p}>
                {rate(value.revenueShare[p], v => onChange({ ...value, revenueShare: { ...value.revenueShare, [p]: v } }), plan.products[p] ? PRODUCT_LABELS[p] : `${PRODUCT_LABELS[p]} (not chosen)`, !plan.products[p])}
              </div>
            ))}
          </div>
          <span className='text-muted-foreground text-xs'>Share of each product&apos;s monthly GGR (bets − wins) due to you. A month with a loss on a product owes nothing for it.</span>
        </div>
      )}
    </div>
  )
}

export default TermsEditor

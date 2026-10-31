'use client'

import { useState } from 'react'

import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import Can from '@/components/shared/Can'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { type ExchangeRateRow } from './types'
import { useCurrencyCodes } from './useCurrencyCodes'

/** Reads are the PUBLIC route; the admin router only writes. */
const READ = 'user/exchange-rate/rates'
const WRITE = 'admin/user/exchange-rate/rates'
const INVALIDATE = [['api', READ]]

/** `usdRate` is "how many USD one unit is worth"; the inverse is what an operator usually thinks in. */
const perUsd = (usdRate: string) => {
  const n = Number(usdRate)

  return Number.isFinite(n) && n > 0 ? (1 / n).toLocaleString('en-IN', { maximumFractionDigits: 8 }) : '—'
}

/** exchangeRate.validators.js `rate`: a decimal > 0 with up to 8 places. */
const rateError = (v: string) => check.number(v, 'USD rate', { positive: true, decimals: 8 })

const EditRate = ({ row }: { row: ExchangeRateRow }) => {
  const [usdRate, setUsdRate] = useState(row.usdRate)

  const update = useApiMutation({
    fn: () => api.put(`${WRITE}/${row.currency}`, { usdRate }),
    invalidate: INVALIDATE,
    success: `${row.currency} rate updated`
  })

  return (
    <FormDialog
      trigger={
        <Button variant='ghost' size='sm'>
          <PencilIcon /> Edit
        </Button>
      }
      title={`${row.currency} rate`}
      description='The USD value of one unit. Every subsequent swap and conversion uses it, so double-check the decimal point.'
      submitLabel='Save rate'
      validate={() => ({ usdRate: rateError(usdRate) })}
      onSubmit={() => update.mutateAsync()}
    >
      <TextField id={`er-${row.currency}`} name='usdRate' inputMode='decimal' label={`1 ${row.currency} = ? USD`} required value={usdRate} onChange={e => setUsdRate(e.target.value)} hint={`Currently 1 USD = ${perUsd(usdRate)} ${row.currency}`} />
    </FormDialog>
  )
}

const DeleteRate = ({ row }: { row: ExchangeRateRow }) => {
  const remove = useApiMutation({
    fn: () => api.delete(`${WRITE}/${row.currency}`),
    invalidate: INVALIDATE,
    success: `${row.currency} rate removed`
  })

  return (
    <ConfirmDialog
      trigger={
        <Button variant='ghost' size='sm' className='text-destructive'>
          <Trash2Icon />
        </Button>
      }
      title={`Remove the ${row.currency} rate?`}
      description='Conversions involving this currency will fail until a rate is added again.'
      confirmLabel='Remove'
      destructive
      onConfirm={() => remove.mutateAsync()}
    />
  )
}

const AddRate = ({ existing }: { existing: string[] }) => {
  // The coin registry (Finance → Coins), or the built-in list when it cannot be read.
  const codes = useCurrencyCodes()
  const free = codes.filter(c => !existing.includes(c))
  const [form, setForm] = useState({ currency: free[0] ?? '', usdRate: '' })

  // The registry may load after the first render: fall back to the first free code.
  const currency = form.currency || free[0] || ''

  const add = useApiMutation({
    fn: () => api.post(WRITE, { currency, usdRate: form.usdRate.trim() }),
    invalidate: INVALIDATE,
    success: `${currency} rate added`,
    onSuccess: () => setForm(f => ({ ...f, usdRate: '' }))
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> Add currency
        </Button>
      }
      title='Add an exchange rate'
      description='Only currencies the wallet supports can carry a rate.'
      submitLabel='Add'
      validate={() => ({
        currency: !currency ? 'Pick a currency' : existing.includes(currency) ? `${currency} already has a rate — edit it instead` : undefined,
        usdRate: rateError(form.usdRate)
      })}
      onSubmit={() => add.mutateAsync()}
    >
      <SelectField id='ar-cur' name='currency' label='Currency' required value={currency} onChange={currency => setForm({ ...form, currency })} options={(free.length ? free : codes).map(c => ({ value: c, label: c }))} />
      <TextField id='ar-rate' name='usdRate' inputMode='decimal' label={`1 ${currency || 'unit'} = ? USD`} required placeholder='0.01200000' value={form.usdRate} onChange={e => setForm({ ...form, usdRate: e.target.value })} />
    </FormDialog>
  )
}

const columns: Column<ExchangeRateRow>[] = [
  { key: 'cur', header: 'Currency', cell: r => <span className='font-medium'>{r.currency}</span> },
  { key: 'usd', header: '1 unit in USD', align: 'right', cell: r => <span className='font-mono tabular-nums'>{r.usdRate}</span> },
  { key: 'inv', header: '1 USD in units', align: 'right', cell: r => <span className='font-mono tabular-nums'>{perUsd(r.usdRate)}</span> },
  { key: 'at', header: 'Updated', cell: r => <DateTime value={r.lastUpdated} relative /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    cell: r => (
      <Can permission='config:write'>
        <div className='flex justify-end gap-1'>
          <EditRate row={r} />
          <DeleteRate row={r} />
        </div>
      </Can>
    )
  }
]

const ExchangeRates = () => {
  const rates = useApi<ExchangeRateRow[]>(READ)
  const rows = rates.data ?? []

  return (
    <div>
      <PageHeader
        title='Exchange rates'
        description='USD value per unit of each currency. Swaps, cross-currency stakes and the INR view of crypto deposits all read from here.'
        actions={
          <Can permission='config:write'>
            <AddRate existing={rows.map(r => r.currency)} />
          </Can>
        }
      />
      <DataTable columns={columns} rows={rates.data} rowKey={r => r.currency} loading={rates.isLoading} fetching={rates.isFetching} error={rates.error} dense />
    </div>
  )
}

export default ExchangeRates

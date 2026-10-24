'use client'

import { useState } from 'react'

import { PencilIcon, PlusIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import FormDialog from '@/components/shared/FormDialog'
import { SwitchField, TextField } from '@/components/shared/FormField'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApi, useApiMutation } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { formatNumber } from '@/lib/format'
import { check } from '@/lib/validate'

import type { CurrencyRow } from './types'
import { CURRENCIES_PATH, useOwnerCoinFilter } from './useCurrencyCodes'

/**
 * The payment destinations a user is shown when they deposit — one list per
 * currency. Writes are multipart because a row may carry a QR image.
 */
type BankRow = {
  id: number
  coin_type?: string
  bankName?: string | null
  accountNumber?: string | null
  ifscCode?: string | null
  accountHolderName?: string | null
  upiId?: string | null
  network?: string | null
  walletAddress?: string | null
  isActive?: boolean
  minAmount?: number | null
  maxAmount?: number | null
  qrImage?: string | null
  createdAt?: string
}

const CURRENCIES = ['INR', 'PKR', 'BDT', 'NPR', 'AED', 'MVR', 'EUR', 'USDT', 'BTC']

/** The same per-network address formats the backend enforces (bank-details/cryptoAddress.js). */
const ADDRESS_FORMATS: Record<string, RegExp> = {
  TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  ERC20: /^0x[0-9a-fA-F]{40}$/,
  BEP20: /^0x[0-9a-fA-F]{40}$/,
  BTC: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/
}

/** The coin's registry row: crypto coins take a network + wallet address instead of bank fields. */
const useCoin = (coin: string) => {
  const registry = useApi<CurrencyRow[]>(CURRENCIES_PATH, undefined, { retry: false, staleTime: 60_000 })

  return Array.isArray(registry.data) ? registry.data.find(c => c.code === coin) : undefined
}

const DetailForm = ({ coin, row, onDone }: { coin: string; row?: BankRow; onDone?: () => void }) => {
  const info = useCoin(coin)
  const crypto = info?.kind === 'crypto'
  const networks = (info?.networks ?? []).filter(n => n.enabled !== false)

  const [form, setForm] = useState({
    network: row?.network ?? '',
    walletAddress: row?.walletAddress ?? '',
    bankName: row?.bankName ?? '',
    accountNumber: row?.accountNumber ?? '',
    ifscCode: row?.ifscCode ?? '',
    accountHolderName: row?.accountHolderName ?? '',
    upiId: row?.upiId ?? '',
    isActive: row?.isActive ?? true,
    minAmount: row?.minAmount?.toString() ?? '',
    maxAmount: row?.maxAmount?.toString() ?? ''
  })

  const [file, setFile] = useState<File | null>(null)

  // bankDetails.validators.js: every text ≤ 255 (account ≤ 100, IFSC ≤ 50); a new row needs an account number or a UPI id.
  // Deposit range: blank = no bound; the player is shown this row only for amounts inside it.
  const amount = (v: string) => (v.trim() === '' ? null : Number(v))

  const range = () => {
    const [min, max] = [amount(form.minAmount), amount(form.maxAmount)]

    return {
      minAmount: min !== null && !(min >= 0) ? 'Enter a number, or leave it blank' : undefined,
      maxAmount: max !== null && !(max >= 0) ? 'Enter a number, or leave it blank' : min !== null && max !== null && min > max ? 'Max must be at least the min' : undefined
    }
  }

  const validate = () => ({ ...range(), ...fields() })

  const fields = () =>
    crypto
      ? {
          network: form.network ? undefined : 'Pick the network',
          walletAddress: !form.walletAddress.trim()
            ? 'The wallet address is required'
            : (ADDRESS_FORMATS[form.network] ?? /^[A-Za-z0-9:_-]{10,128}$/).test(form.walletAddress.trim())
              ? undefined
              : `This is not a valid ${form.network || 'network'} address`,
          accountHolderName: check.length(form.accountHolderName, 'Label', { max: 255 })
        }
      : {
    accountHolderName: check.length(form.accountHolderName, 'Account holder', { max: 255 }),
    bankName: check.length(form.bankName, 'Bank name', { max: 255 }),
    ifscCode: check.length(form.ifscCode, 'IFSC / SWIFT', { max: 50 }),
    accountNumber:
      !form.accountNumber.trim() && !form.upiId.trim() ? 'Either an account number or a UPI id is required' : check.length(form.accountNumber, 'Account number', { max: 100 }),
    upiId: check.length(form.upiId, 'UPI id', { max: 255 }),
    'bd-qr': file && !['image/png', 'image/jpeg'].includes(file.type) ? 'QR image must be a PNG or JPEG' : file && file.size > 2 * 1024 * 1024 ? 'QR image must be 2 MB or smaller' : undefined
  }

  const save = useApiMutation({
    fn: () => {
      // Multipart even without a file: the backend parses these routes with multer.
      const fd = new FormData()

      // A blank min / max is sent too: it clears the bound.
      for (const [k, v] of Object.entries(form)) if (v !== '' || k === 'minAmount' || k === 'maxAmount') fd.set(k, String(v))
      if (file) fd.set('qr_image', file)

      return row
        ? api.upload(`admin/user/bank-details/${coin}/${row.id}`, fd, 'PUT')
        : api.upload(`admin/user/bank-details/${coin}`, fd, 'POST')
    },
    invalidate: [['api', `admin/user/bank-details/${coin}`]],
    success: row ? 'Destination updated' : 'Destination added',
    onSuccess: () => onDone?.()
  })

  return (
    <FormDialog
      trigger={
        row ? (
          <Button variant='ghost' size='icon-sm' aria-label='Edit'>
            <PencilIcon />
          </Button>
        ) : (
          <Button>
            <PlusIcon /> Add destination
          </Button>
        )
      }
      title={row ? `Edit ${coin} destination` : `New ${coin} destination`}
      description={
        crypto
          ? 'The address players send this coin to. Double-check it — money sent to a wrong address is lost. The QR image is optional.'
          : 'Either an account number or a UPI id is required. The QR image is optional and replaces the stored one.'
      }
      submitLabel={row ? 'Save' : 'Add'}
      validate={validate}
      onSubmit={() => save.mutateAsync()}
    >
      {crypto ? (
        <>
          <div className='grid gap-2'>
            <label className='text-sm font-medium'>Network</label>
            <Select value={form.network} onValueChange={v => v && setForm({ ...form, network: v })}>
              <SelectTrigger aria-label='Network'>
                <SelectValue placeholder='Pick a network' />
              </SelectTrigger>
              <SelectContent>
                {networks.map(n => (
                  <SelectItem key={n.key} value={n.key}>
                    {n.name || n.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextField id='bd-address' name='walletAddress' label='Wallet address' value={form.walletAddress} onChange={e => setForm({ ...form, walletAddress: e.target.value })} />
          <TextField id='bd-holder' name='accountHolderName' label='Label (optional)' value={form.accountHolderName} onChange={e => setForm({ ...form, accountHolderName: e.target.value })} />
        </>
      ) : (
        <>
      <TextField id='bd-holder' name='accountHolderName' label='Account holder' value={form.accountHolderName} onChange={e => setForm({ ...form, accountHolderName: e.target.value })} />
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='bd-bank' name='bankName' label='Bank name' value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} />
        <TextField id='bd-ifsc' name='ifscCode' label='IFSC / SWIFT' value={form.ifscCode} onChange={e => setForm({ ...form, ifscCode: e.target.value })} />
      </div>
      <TextField id='bd-acct' name='accountNumber' label='Account number' value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} />
      <TextField id='bd-upi' name='upiId' label='UPI id' value={form.upiId} onChange={e => setForm({ ...form, upiId: e.target.value })} />
        </>
      )}
      <div className='grid gap-2'>
        <label htmlFor='bd-qr' className='text-sm font-medium'>
          QR image (PNG or JPEG, max 2 MB)
        </label>
        <input id='bd-qr' type='file' accept='image/png,image/jpeg' className='text-sm' onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='bd-min' name='minAmount' label={`Min deposit (${coin})`} inputMode='decimal' placeholder='No minimum' value={form.minAmount} onChange={e => setForm({ ...form, minAmount: e.target.value })} />
        <TextField id='bd-max' name='maxAmount' label={`Max deposit (${coin})`} inputMode='decimal' placeholder='No maximum' value={form.maxAmount} onChange={e => setForm({ ...form, maxAmount: e.target.value })} />
      </div>
      <SwitchField id='bd-active' label='Shown to users' checked={form.isActive} onChange={isActive => setForm({ ...form, isActive })} />
    </FormDialog>
  )
}

const BankDetails = () => {
  const coins = useOwnerCoinFilter()(CURRENCIES)
  const [picked, setCoin] = useState('INR')

  // INR is the usual pick; when the owner has it off, the first currency still in the plan.
  const coin = coins.includes(picked) ? picked : (coins[0] ?? '')
  const list = useApi<BankRow[]>(coin ? `admin/user/bank-details/${coin}` : null, undefined, { retry: false })

  const toggle = useApiMutation({
    fn: ({ id, isActive }: { id: number; isActive: boolean }) => {
      const fd = new FormData()

      fd.set('isActive', String(isActive))

      return api.upload(`admin/user/bank-details/${coin}/${id}`, fd, 'PUT')
    },
    invalidate: [['api', `admin/user/bank-details/${coin}`]],
    success: (_r, v) => (v.isActive ? 'Shown to users' : 'Hidden from users')
  })

  const range = (r: BankRow) =>
    r.minAmount == null && r.maxAmount == null
      ? 'Any amount'
      : `${r.minAmount == null ? '0' : formatNumber(r.minAmount)} – ${r.maxAmount == null ? 'no max' : formatNumber(r.maxAmount)}`

  const statusColumn: Column<BankRow> = {
    key: 'active',
    header: 'Shown to users',
    cell: r => (
      <Can permission='config:write' fallback={<Switch checked={r.isActive !== false} disabled aria-label='Shown to users' />}>
        <Switch checked={r.isActive !== false} disabled={toggle.isPending} aria-label='Shown to users' onCheckedChange={isActive => toggle.mutate({ id: r.id, isActive })} />
      </Can>
    )
  }

  const rangeColumn: Column<BankRow> = { key: 'range', header: 'Deposit range', cell: r => <span className='text-xs whitespace-nowrap'>{range(r)}</span> }

  const crypto = useCoin(coin)?.kind === 'crypto'

  const columns: Column<BankRow>[] = crypto
    ? [
        { key: 'label', header: 'Label', cell: r => <span className='font-medium'>{r.accountHolderName ?? '—'}</span> },
        { key: 'network', header: 'Network', cell: r => <span>{r.network ?? '—'}</span> },
        { key: 'address', header: 'Wallet address', cell: r => <span className='font-mono text-xs break-all'>{r.walletAddress ?? '—'}</span> },
        rangeColumn,
        statusColumn
      ]
    : [
    { key: 'holder', header: 'Account holder', cell: r => <span className='font-medium'>{r.accountHolderName ?? '—'}</span> },
    { key: 'bank', header: 'Bank', cell: r => <span>{r.bankName ?? '—'}{r.ifscCode ? <span className='text-muted-foreground'> · {r.ifscCode}</span> : null}</span> },
    { key: 'acct', header: 'Account', cell: r => <span className='font-mono text-xs'>{r.accountNumber ?? '—'}</span> },
    { key: 'upi', header: 'UPI', cell: r => <span className='font-mono text-xs'>{r.upiId ?? '—'}</span> },
    rangeColumn,
    statusColumn
  ]

  columns.push(
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: r => (
        <Can permission='config:write'>
          <span className='flex justify-end gap-1'>
            <DetailForm coin={coin} row={r} />
          </span>
        </Can>
      )
    }
  )

  return (
    <div>
      <PageHeader
        title='Bank details'
        description='Where users send manual deposits, one list per currency: bank or UPI for fiat, a wallet address per network for crypto. Only rows switched on are shown to users, and only for a deposit amount inside its range: the user enters the amount first, then sees the matching accounts.'
        actions={
          <>
            <Select value={coin} onValueChange={v => v && setCoin(v)}>
              <SelectTrigger className='w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {coins.map(c => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Can permission='config:write'>
              <DetailForm coin={coin} />
            </Can>
          </>
        }
      />
      <DataTable
        columns={columns}
        rows={list.data}
        rowKey={r => r.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        emptyMessage={`No ${coin} destination configured yet.`}
      />
    </div>
  )
}

export default BankDetails

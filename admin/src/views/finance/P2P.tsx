'use client'

import { useState, type ReactNode } from 'react'

import Link from 'next/link'

import { BanIcon, CheckIcon, EyeIcon, GavelIcon, PlusIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { SelectField, SwitchField, TextAreaField, TextField } from '@/components/shared/FormField'
import JsonView from '@/components/shared/JsonView'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, useApiMutation, useListState } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { truncateId } from '@/lib/format'
import { check } from '@/lib/validate'
import { Details, ImageDialog, ViewDialog, stop, usePageNumbered } from './shared'
import { TxnPasswordLabel } from './StaffFloat'
import {
  P2P_COINS,
  P2P_DISPUTE_STATUSES,
  P2P_FIAT,
  P2P_OFFER_STATUSES,
  P2P_ORDER_STATUSES,
  P2P_SELL_STATUSES,
  type P2pDisputeRow,
  type P2pOfferRow,
  type P2pOrderRow,
  type P2pPaymentAccount,
  type P2pPaymentType
} from './types'
import { useOwnerCoinFilter } from './useCurrencyCodes'

const BASE = 'admin/user/p2p'
const ALL_LISTS = [['paged', `${BASE}/orders`], ['paged', `${BASE}/sell-orders`], ['paged', `${BASE}/disputes`], ['paged', `${BASE}/offers`]]

/** p2p.validators.js `amount`: a decimal > 0 with up to 8 places. */
const p2pAmount = (v: string, label: string, optional = false) => check.number(v, label, { positive: true, decimals: 8, optional })

const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v))
const at = (r: Record<string, unknown>) => s(r.created_at ?? r.createdAt)

/** Small status-select filter used by every tab. */
const StatusFilter = ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) => (
  <Select value={value || 'all'} onValueChange={v => v && onChange(v === 'all' ? '' : v)}>
    <SelectTrigger className='w-40'>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value='all'>All statuses</SelectItem>
      {options.map(o => (
        <SelectItem key={o} value={o}>
          {o.replace(/_/g, ' ')}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
)

/** A money action with an optional note (`{ note? }` body). */
const NoteAction = ({ path, title, description, label, icon, destructive, success, multipart }: { path: string; title: string; description: ReactNode; label: string; icon: ReactNode; destructive?: boolean; success: string; multipart?: boolean }) => {
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [code, setCode] = useState('')

  const run = useApiMutation({
    fn: () => {
      if (multipart) {
        const form = new FormData()

        if (note) form.append('note', note)
        if (file) form.append('admin_payment_proof', file)
        form.append('transactionPassword', code)

        return api.upload(path, form)
      }

      return api.post(path, { ...(note ? { note } : {}), transactionPassword: code })
    },
    invalidate: ALL_LISTS,
    success
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant={destructive ? 'destructive' : 'default'}>
          {icon} {label}
        </Button>
      }
      title={title}
      description={description}
      submitLabel={label}
      destructive={destructive}
      validate={() => ({
        [`na-${path}`]: check.length(note, 'Note', { max: 2000 }),
        [`nf-${path}`]: file && !['image/png', 'image/jpeg'].includes(file.type) ? 'Payment proof must be a PNG or JPEG image' : undefined,
        [`nt-${path}`]: code ? undefined : 'Transaction password is required'
      })}
      onSubmit={() => run.mutateAsync()}
    >
      <TextAreaField id={`na-${path}`} label='Note' value={note} onChange={e => setNote(e.target.value)} />
      {multipart && (
        <div className='grid gap-2'>
          <label htmlFor={`nf-${path}`} className='text-sm font-medium'>
            Payment proof (image)
          </label>
          <Input id={`nf-${path}`} type='file' accept='image/png,image/jpeg' onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
      )}
      <TextField id={`nt-${path}`} name='transactionPassword' label={<TxnPasswordLabel />} type='password' autoComplete='new-password' required value={code} onChange={e => setCode(e.target.value)} />
    </FormDialog>
  )
}

const OrderStatus = ({ id }: { id: string | number }) => {
  const [form, setForm] = useState({ status: 'DISPUTED', note: '' })

  const set = useApiMutation({
    fn: () => api.patch(`${BASE}/orders/${id}/status`, form.note ? form : { status: form.status }),
    invalidate: ALL_LISTS,
    success: 'Order status updated'
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant='outline'>
          <GavelIcon /> Status
        </Button>
      }
      title={`Order #${id} — set status`}
      description='Only the two transitions that move no money. Releasing and cancelling have their own actions.'
      submitLabel='Set status'
      validate={() => ({ [`on-${id}`]: check.length(form.note, 'Note', { max: 2000 }) })}
      onSubmit={() => set.mutateAsync()}
    >
      <SelectField id={`os-${id}`} label='Status' value={form.status} onChange={status => setForm({ ...form, status })} options={['DISPUTED', 'EXPIRED'].map(v => ({ value: v, label: v }))} />
      <TextAreaField id={`on-${id}`} label='Note' value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
    </FormDialog>
  )
}

const OrderDetail = ({ row, kind }: { row: P2pOrderRow; kind: 'orders' | 'sell-orders' }) => (
  <ViewDialog
    trigger={
      <Button variant='ghost' size='sm'>
        <EyeIcon />
      </Button>
    }
    title={`${kind === 'orders' ? 'Buy' : 'Sell'} order ${row.order_no ?? `#${row.id}`}`}
    description={
      <span className='inline-flex items-center gap-2'>
        <StatusBadge value={row.status} /> <DateTime value={at(row)} />
      </span>
    }
    wide
  >
    <Details
      items={[
        ['User', row.user_id ? <Link key='u' href={`/users/${row.user_id}`} className='underline'>#{row.user_id}</Link> : null],
        ['Offer', s(row.offer_id)],
        ['Crypto', <Money key='c' value={s(row.crypto_amount)} currency={row.coin} />],
        ['Fiat', <Money key='f' value={s(row.fiat_amount)} currency={row.fiat} />],
        ['Price', <Money key='p' value={s(row.price)} currency={row.fiat} />],
        ['UTR', row.utr_number],
        ['Account', [row.account_name, row.account_number, row.ifsc_code, row.upi_id].filter(Boolean).join(' · ') || null],
        ['Expires', row.expires_at ? <DateTime key='e' value={s(row.expires_at)} relative /> : null],
        ['Paid at', row.paid_at ? <DateTime key='pa' value={s(row.paid_at)} /> : null],
        ['Admin note', row.admin_note]
      ]}
    />
    <div className='flex flex-wrap gap-2'>
      {kind === 'orders' && (row.payment_proof_size || row.utr_number) ? <ImageDialog path={`${BASE}/orders/${row.id}/proof`} title={`Payment proof — ${row.order_no ?? row.id}`} label='Payment proof' /> : null}
      {kind === 'sell-orders' && <ImageDialog path={`${BASE}/sell-orders/${row.id}/proof`} title={`Operator payment proof — ${row.order_no ?? row.id}`} label='Payment proof' />}
      {kind === 'sell-orders' && row.qr_image_type ? <ImageDialog path={`${BASE}/sell-orders/${row.id}/qr`} title={`Seller QR — ${row.order_no ?? row.id}`} label='Seller QR' /> : null}
    </div>
    <JsonView value={row} className='max-h-60' />
  </ViewDialog>
)

const orderColumns = (kind: 'orders' | 'sell-orders'): Column<P2pOrderRow>[] => [
  { key: 'no', header: 'Order', cell: r => <span className='font-mono text-xs'>{r.order_no ?? r.id}</span> },
  { key: 'user', header: 'User', cell: r => (r.user_id ? <Link href={`/users/${r.user_id}`} className='font-mono text-xs hover:underline'>#{r.user_id}</Link> : '—') },
  { key: 'crypto', header: 'Crypto', align: 'right', cell: r => <Money value={s(r.crypto_amount)} currency={r.coin} /> },
  { key: 'fiat', header: 'Fiat', align: 'right', cell: r => <Money value={s(r.fiat_amount)} currency={r.fiat} /> },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  { key: 'utr', header: kind === 'orders' ? 'UTR' : 'Pay to', cell: r => <span className='font-mono text-xs'>{kind === 'orders' ? (r.utr_number ?? '—') : (r.upi_id ?? r.account_number ?? '—')}</span> },
  { key: 'exp', header: 'Expires', cell: r => <DateTime value={s(r.expires_at)} relative /> },
  { key: 'at', header: 'Created', cell: r => <DateTime value={at(r)} /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    cell: r => {
      const open = kind === 'orders' ? ['PENDING', 'PAID', 'DISPUTED'] : ['PENDING', 'DISPUTED']
      const isOpen = open.includes(String(r.status))

      return (
        <div className='flex justify-end gap-1' onClick={stop}>
          <OrderDetail row={r} kind={kind} />
          {isOpen && (
            <>
              <Can permission='wallet:adjust'>
                <NoteAction
                  path={`${BASE}/${kind}/${r.id}/release`}
                  title={`Release ${r.order_no ?? `#${r.id}`}?`}
                  description={kind === 'orders' ? <>Credits <Money value={s(r.crypto_amount)} currency={r.coin} /> to user #{r.user_id}. Only valid once the order is PAID. Idempotent.</> : <>Records that you paid the seller <Money value={s(r.fiat_amount)} currency={r.fiat} /> and closes the order. The crypto was already taken when it opened.</>}
                  label='Release'
                  icon={<CheckIcon />}
                  success='Order released'
                  multipart={kind === 'sell-orders'}
                />
                <NoteAction
                  path={`${BASE}/${kind}/${r.id}/cancel`}
                  title={`Cancel ${r.order_no ?? `#${r.id}`}?`}
                  description={kind === 'orders' ? 'No crypto moves. The buyer keeps whatever they paid off-platform — resolve that through a dispute.' : 'Refunds the seller their held crypto, once.'}
                  label='Cancel'
                  icon={<BanIcon />}
                  destructive
                  success='Order cancelled'
                />
              </Can>
              {kind === 'orders' && (
                <Can permission='config:write'>
                  <OrderStatus id={r.id} />
                </Can>
              )}
            </>
          )}
        </div>
      )
    }
  }
]

/** The coins P2P trades that are in the owner's plan. */
const useP2pCoins = () => useOwnerCoinFilter()(P2P_COINS)

const Orders = ({ kind }: { kind: 'orders' | 'sell-orders' }) => {
  const { state, set, query } = useListState(['status', 'userId'])
  const list = usePageNumbered<P2pOrderRow>(`${BASE}/${kind}`, { page: query.page, limit: query.limit, status: query.status, userId: query.userId })

  return (
    <DataTable
      columns={orderColumns(kind)}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      toolbar={
        <>
          <StatusFilter value={String(state.status ?? '')} onChange={status => set({ status })} options={kind === 'orders' ? P2P_ORDER_STATUSES : P2P_SELL_STATUSES} />
          <Input placeholder='User id' aria-label='User id' value={String(state.userId ?? '')} onChange={e => set({ userId: e.target.value })} className='w-32' />
        </>
      }
    />
  )
}

const DisputeStatus = ({ row }: { row: P2pDisputeRow }) => {
  const [form, setForm] = useState({ status: row.status === 'OPEN' ? 'UNDER_REVIEW' : 'RESOLVED', adminNote: '' })

  const set = useApiMutation({
    fn: () => api.patch(`${BASE}/disputes/${row.id}/status`, form.adminNote ? form : { status: form.status }),
    invalidate: ALL_LISTS,
    success: 'Dispute updated'
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm'>
          <GavelIcon /> Resolve
        </Button>
      }
      title={`Dispute #${row.id} — ${row.order_no ?? `order ${row.order_id}`}`}
      description='Resolving takes the order out of DISPUTED so it can be released or cancelled. No money moves here.'
      submitLabel='Apply'
      validate={() => ({ [`dn-${row.id}`]: check.length(form.adminNote, 'Admin note', { max: 4000 }) })}
      onSubmit={() => set.mutateAsync()}
    >
      <SelectField id={`ds-${row.id}`} label='Status' value={form.status} onChange={status => setForm({ ...form, status })} options={P2P_DISPUTE_STATUSES.map(v => ({ value: v, label: v.replace(/_/g, ' ') }))} />
      <TextAreaField id={`dn-${row.id}`} label='Admin note' value={form.adminNote} onChange={e => setForm({ ...form, adminNote: e.target.value })} />
    </FormDialog>
  )
}

const disputeColumns: Column<P2pDisputeRow>[] = [
  { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'order', header: 'Order', cell: r => <span className='font-mono text-xs'>{r.order_no ?? `#${r.order_id}`}</span> },
  { key: 'type', header: 'Type', cell: r => <Badge variant='outline'>{r.order_type ?? '—'}</Badge> },
  { key: 'user', header: 'User', cell: r => (r.user_id ? <Link href={`/users/${r.user_id}`} className='font-mono text-xs hover:underline'>#{r.user_id}</Link> : '—') },
  { key: 'reason', header: 'Reason', cell: r => <span className='text-sm' title={r.message ?? ''}>{r.reason ?? '—'}{r.message ? <span className='text-muted-foreground'> — {truncateId(r.message, 20)}</span> : null}</span> },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  { key: 'at', header: 'Opened', cell: r => <DateTime value={at(r)} /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    cell: r => (
      <div className='flex justify-end gap-1' onClick={stop}>
        {r.screenshot_size ? <ImageDialog path={`${BASE}/disputes/${r.id}/screenshot`} title={`Dispute #${r.id} screenshot`} label='Screenshot' /> : null}
        {r.status !== 'RESOLVED' && r.status !== 'REJECTED' && (
          <Can permission='config:write'>
            <DisputeStatus row={r} />
          </Can>
        )}
      </div>
    )
  }
]

const Disputes = () => {
  const { state, set, query } = useListState(['status'])
  const list = usePageNumbered<P2pDisputeRow>(`${BASE}/disputes`, { page: query.page, limit: query.limit, status: query.status })

  return (
    <DataTable
      columns={disputeColumns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      toolbar={<StatusFilter value={String(state.status ?? '')} onChange={status => set({ status })} options={P2P_DISPUTE_STATUSES} />}
    />
  )
}

const OfferStatus = ({ row }: { row: P2pOfferRow }) => {
  const [status, setStatus] = useState(String(row.status ?? 'ACTIVE'))

  const set = useApiMutation({
    fn: () => api.patch(`${BASE}/offers/${row.id}/status`, { status }),
    invalidate: ALL_LISTS,
    success: `Offer #${row.id} set to ${status}`
  })

  return (
    <FormDialog
      trigger={
        <Button size='sm' variant='outline'>
          <GavelIcon /> Status
        </Button>
      }
      title={`Offer #${row.id} — status`}
      submitLabel='Set'
      onSubmit={() => set.mutateAsync()}
    >
      <SelectField id={`ofs-${row.id}`} label='Status' value={status} onChange={setStatus} options={P2P_OFFER_STATUSES.map(v => ({ value: v, label: v }))} />
    </FormDialog>
  )
}

const CreateOffer = ({ accounts }: { accounts: P2pPaymentAccount[] }) => {
  const coins = useP2pCoins()
  const ownerCoins = useOwnerCoinFilter()
  const [form, setForm] = useState({ coin: 'USDT', fiat: 'INR', segment: 'BUY', price: '', availableAmount: '', minLimit: '', maxLimit: '', username: '', paymentAccountIds: '', paymentTime: '', isFeatured: false, isVerified: false, isKycVerified: false })

  // USDT is the usual pick; when the owner has it off, the first coin P2P still trades.
  const coin = coins.includes(form.coin) ? form.coin : (coins[0] ?? '')

  const create = useApiMutation({
    fn: () => {
      const body: Record<string, unknown> = {
        coin,
        fiat: form.fiat,
        segment: form.segment,
        price: form.price,
        availableAmount: form.availableAmount,
        username: form.username,
        paymentAccountIds: form.paymentAccountIds.split(/[\s,]+/).filter(Boolean).map(Number),
        isFeatured: form.isFeatured,
        isVerified: form.isVerified,
        isKycVerified: form.isKycVerified
      }

      if (form.minLimit) body.minLimit = form.minLimit
      if (form.maxLimit) body.maxLimit = form.maxLimit
      if (form.paymentTime) body.paymentTime = Number(form.paymentTime)

      return api.post(`${BASE}/offers`, body)
    },
    invalidate: [['paged', `${BASE}/offers`]],
    success: 'Offer created'
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> New offer
        </Button>
      }
      title='Create a P2P offer'
      description='A house offer users trade against. Amounts and price are decimal strings.'
      submitLabel='Create'
      wide
      validate={() => {
        const ids = form.paymentAccountIds.split(/[\s,]+/).filter(Boolean)

        return {
          coin: coin ? undefined : 'No P2P coin is enabled for this site',
          price: p2pAmount(form.price, 'Price'),
          availableAmount: p2pAmount(form.availableAmount, 'Available amount'),
          minLimit: p2pAmount(form.minLimit, 'Min limit', true),
          maxLimit:
            p2pAmount(form.maxLimit, 'Max limit', true) ??
            (form.minLimit && form.maxLimit && Number(form.minLimit) > Number(form.maxLimit) ? 'Max limit cannot be below the min limit' : undefined),
          paymentTime: check.number(form.paymentTime, 'Payment window', { integer: true, min: 5, max: 1440, optional: true }),
          username: check.required(form.username, 'Merchant display name') ?? check.length(form.username, 'Merchant display name', { max: 255 }),
          paymentAccountIds: !ids.length
            ? 'Payment account ids are required'
            : ids.some(x => !/^\d+$/.test(x) || Number(x) <= 0)
              ? 'Payment account ids must be positive numbers, comma-separated'
              : ids.length > 20
                ? 'At most 20 payment accounts'
                : undefined
        }
      }}
      onSubmit={() => create.mutateAsync()}
    >
      <div className='grid grid-cols-3 gap-4'>
        <SelectField id='of-coin' name='coin' label='Coin' value={coin} onChange={coin => setForm({ ...form, coin })} options={coins.map(c => ({ value: c, label: c }))} />
        <SelectField id='of-fiat' label='Fiat' value={form.fiat} onChange={fiat => setForm({ ...form, fiat })} options={ownerCoins(P2P_FIAT).map(c => ({ value: c, label: c }))} />
        <SelectField id='of-seg' label='Segment' value={form.segment} onChange={segment => setForm({ ...form, segment })} options={[{ value: 'BUY', label: 'BUY (user buys crypto)' }, { value: 'SELL', label: 'SELL (user sells crypto)' }]} />
      </div>
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='of-price' name='price' inputMode='decimal' label={`Price (${form.fiat} per ${coin})`} required value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
        <TextField id='of-avail' name='availableAmount' inputMode='decimal' label={`Available (${coin})`} required value={form.availableAmount} onChange={e => setForm({ ...form, availableAmount: e.target.value })} />
      </div>
      <div className='grid grid-cols-3 gap-4'>
        <TextField id='of-min' name='minLimit' inputMode='decimal' label='Min limit' value={form.minLimit} onChange={e => setForm({ ...form, minLimit: e.target.value })} />
        <TextField id='of-max' name='maxLimit' inputMode='decimal' label='Max limit' value={form.maxLimit} onChange={e => setForm({ ...form, maxLimit: e.target.value })} />
        <TextField id='of-time' name='paymentTime' label='Payment window (min)' type='number' min={5} max={1440} value={form.paymentTime} onChange={e => setForm({ ...form, paymentTime: e.target.value })} />
      </div>
      <TextField id='of-user' name='username' label='Merchant display name' required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
      <TextField id='of-acc' name='paymentAccountIds' label='Payment account ids' required placeholder='1, 2' hint={accounts.length ? `Known: ${accounts.map(a => `#${a.id} ${a.accountName ?? a.upiId ?? a.accountNumber ?? ''}`).join(', ')}` : 'Comma-separated ids from the Payment accounts tab'} value={form.paymentAccountIds} onChange={e => setForm({ ...form, paymentAccountIds: e.target.value })} />
      <div className='grid grid-cols-3 gap-2'>
        <SwitchField id='of-feat' label='Featured' checked={form.isFeatured} onChange={isFeatured => setForm({ ...form, isFeatured })} />
        <SwitchField id='of-ver' label='Verified' checked={form.isVerified} onChange={isVerified => setForm({ ...form, isVerified })} />
        <SwitchField id='of-kyc' label='KYC badge' checked={form.isKycVerified} onChange={isKycVerified => setForm({ ...form, isKycVerified })} />
      </div>
    </FormDialog>
  )
}

const offerColumns: Column<P2pOfferRow>[] = [
  { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'merchant', header: 'Merchant', cell: r => <span className='font-medium'>{r.username ?? '—'}</span> },
  { key: 'pair', header: 'Pair', cell: r => <span className='text-sm'>{r.coin}/{r.fiat}</span> },
  { key: 'seg', header: 'Segment', cell: r => <Badge variant='outline'>{r.segment ?? '—'}</Badge> },
  { key: 'price', header: 'Price', align: 'right', cell: r => <Money value={r.price} currency={r.fiat} /> },
  { key: 'avail', header: 'Available', align: 'right', cell: r => <Money value={r.availableAmount} currency={r.coin} /> },
  { key: 'limits', header: 'Limits', cell: r => <span className='font-mono text-xs'>{r.minLimit ?? '—'} – {r.maxLimit ?? '—'}</span> },
  { key: 'badges', header: 'Badges', cell: r => <span className='text-muted-foreground text-xs'>{[r.isFeatured && 'featured', r.isVerified && 'verified', r.isKycVerified && 'kyc'].filter(Boolean).join(' · ') || '—'}</span> },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    cell: r => (
      <Can permission='config:write'>
        <OfferStatus row={r} />
      </Can>
    )
  }
]

const Offers = ({ accounts }: { accounts: P2pPaymentAccount[] }) => {
  const { set, query } = useListState()
  const list = usePageNumbered<P2pOfferRow>(`${BASE}/offers`, { page: query.page, limit: query.limit })

  return (
    <DataTable
      columns={offerColumns}
      rows={list.data?.rows}
      rowKey={r => r.id}
      loading={list.isLoading}
      fetching={list.isFetching}
      error={list.error}
      pagination={list.data?.pagination}
      onPageChange={page => set({ page })}
      onLimitChange={limit => set({ limit })}
      toolbar={
        <>
          <Can permission='config:write'>
            <CreateOffer accounts={accounts} />
          </Can>
        </>
      }
    />
  )
}

const CreateType = () => {
  const [form, setForm] = useState({ name: '', code: '' })
  const create = useApiMutation({ fn: () => api.post(`${BASE}/payment-types`, form), invalidate: [['api', `${BASE}/payment-types`]], success: 'Payment type added' })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> New type
        </Button>
      }
      title='New payment type'
      submitLabel='Add'
      validate={() => ({
        name: check.required(form.name, 'Name') ?? check.length(form.name, 'Name', { max: 100 }),
        code:
          check.required(form.code, 'Code') ??
          check.length(form.code, 'Code', { max: 50 }) ??
          (/^[a-z0-9][a-z0-9_-]*$/.test(form.code.trim()) ? undefined : 'Code must be lowercase letters, digits, dash and underscore')
      })}
      onSubmit={() => create.mutateAsync()}
    >
      <TextField id='pt-name' name='name' label='Name' required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      <TextField id='pt-code' name='code' label='Code' required placeholder='upi' hint='Lowercase letters, digits, dash, underscore' value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
    </FormDialog>
  )
}

const CreateAccount = ({ types }: { types: P2pPaymentType[] }) => {
  const [form, setForm] = useState({ paymentTypeId: String(types[0]?.id ?? ''), accountName: '', accountNumber: '', ifscCode: '', upiId: '', extraDetails: '' })
  const [file, setFile] = useState<File | null>(null)

  const create = useApiMutation({
    fn: () => {
      const fd = new FormData()

      fd.append('paymentTypeId', form.paymentTypeId || String(types[0]?.id ?? ''))
      for (const k of ['accountName', 'accountNumber', 'ifscCode', 'upiId', 'extraDetails'] as const) if (form[k]) fd.append(k, form[k])
      if (file) fd.append('qr_image', file)

      return api.upload(`${BASE}/payment-accounts`, fd)
    },
    invalidate: [['api', `${BASE}/payment-accounts`]],
    success: 'Payment account added'
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> New account
        </Button>
      }
      title='New payment account'
      description='A house account users pay into. Needs an account number or a UPI id.'
      submitLabel='Add'
      validate={() => ({
        paymentTypeId: form.paymentTypeId || types[0]?.id ? undefined : 'Create a payment type first',
        accountName: check.length(form.accountName, 'Account name', { max: 255 }),
        accountNumber: !form.accountNumber.trim() && !form.upiId.trim() ? 'A payment account needs an account number or a UPI id' : check.length(form.accountNumber, 'Account number', { max: 100 }),
        ifscCode: check.length(form.ifscCode, 'IFSC', { max: 50 }),
        upiId: check.length(form.upiId, 'UPI id', { max: 255 }),
        extraDetails: check.length(form.extraDetails, 'Extra details', { max: 2000 }),
        'pa-qr': file && !['image/png', 'image/jpeg'].includes(file.type) ? 'QR image must be a PNG or JPEG' : undefined
      })}
      onSubmit={() => create.mutateAsync()}
    >
      <SelectField id='pa-type' name='paymentTypeId' label='Payment type' required value={form.paymentTypeId || String(types[0]?.id ?? '')} onChange={paymentTypeId => setForm({ ...form, paymentTypeId })} options={types.map(t => ({ value: String(t.id), label: `${t.name ?? t.code ?? t.id}` }))} placeholder='Create a payment type first' />
      <TextField id='pa-name' name='accountName' label='Account name' value={form.accountName} onChange={e => setForm({ ...form, accountName: e.target.value })} />
      <div className='grid grid-cols-2 gap-4'>
        <TextField id='pa-num' name='accountNumber' label='Account number' value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} />
        <TextField id='pa-ifsc' name='ifscCode' label='IFSC' value={form.ifscCode} onChange={e => setForm({ ...form, ifscCode: e.target.value })} />
      </div>
      <TextField id='pa-upi' name='upiId' label='UPI id' value={form.upiId} onChange={e => setForm({ ...form, upiId: e.target.value })} />
      <TextAreaField id='pa-extra' name='extraDetails' label='Extra details' value={form.extraDetails} onChange={e => setForm({ ...form, extraDetails: e.target.value })} />
      <div className='grid gap-2'>
        <label htmlFor='pa-qr' className='text-sm font-medium'>
          QR image
        </label>
        <Input id='pa-qr' type='file' accept='image/png,image/jpeg' onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </div>
    </FormDialog>
  )
}

const typeColumns: Column<P2pPaymentType>[] = [
  { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'name', header: 'Name', cell: r => <span className='font-medium'>{r.name ?? '—'}</span> },
  { key: 'code', header: 'Code', cell: r => <span className='font-mono text-xs'>{r.code ?? '—'}</span> },
  { key: 'at', header: 'Created', cell: r => <DateTime value={at(r)} /> }
]

const accountColumns: Column<P2pPaymentAccount>[] = [
  { key: 'id', header: 'ID', cell: r => <span className='font-mono text-xs'>{r.id}</span> },
  { key: 'type', header: 'Type', cell: r => <span className='text-sm'>{s(r.paymentTypeName ?? r.paymentTypeId) ?? '—'}</span> },
  { key: 'name', header: 'Account name', cell: r => <span className='text-sm'>{r.accountName ?? '—'}</span> },
  { key: 'num', header: 'Account no.', cell: r => <span className='font-mono text-xs'>{r.accountNumber ?? '—'}</span> },
  { key: 'ifsc', header: 'IFSC', cell: r => <span className='font-mono text-xs'>{r.ifscCode ?? '—'}</span> },
  { key: 'upi', header: 'UPI', cell: r => <span className='text-sm'>{r.upiId ?? '—'}</span> },
  { key: 'extra', header: 'Extra', cell: r => <span className='text-muted-foreground text-xs'>{r.extraDetails ?? '—'}</span> }
]

const P2P = () => {
  const types = useApi<P2pPaymentType[]>(`${BASE}/payment-types`)
  const accounts = useApi<P2pPaymentAccount[]>(`${BASE}/payment-accounts`)

  return (
    <div>
      <PageHeader title='P2P trading' description='Peer trades against house offers. Release pays out and cancel refunds — both audited under your name; disputes must be resolved before either.' />
      <Tabs defaultValue='orders'>
        <TabsList className='mb-4 flex-wrap'>
          <TabsTrigger value='orders'>Buy orders</TabsTrigger>
          <TabsTrigger value='sell'>Sell orders</TabsTrigger>
          <TabsTrigger value='disputes'>Disputes</TabsTrigger>
          <TabsTrigger value='offers'>Offers</TabsTrigger>
          <TabsTrigger value='types'>Payment types</TabsTrigger>
          <TabsTrigger value='accounts'>Payment accounts</TabsTrigger>
        </TabsList>
        <TabsContent value='orders'>
          <Orders kind='orders' />
        </TabsContent>
        <TabsContent value='sell'>
          <Orders kind='sell-orders' />
        </TabsContent>
        <TabsContent value='disputes'>
          <Disputes />
        </TabsContent>
        <TabsContent value='offers'>
          <Offers accounts={accounts.data ?? []} />
        </TabsContent>
        <TabsContent value='types'>
          <DataTable
            columns={typeColumns}
            rows={types.data}
            rowKey={r => r.id}
            loading={types.isLoading}
            error={types.error}
            dense
            toolbar={
              <Can permission='config:write'>
                <CreateType />
              </Can>
            }
          />
        </TabsContent>
        <TabsContent value='accounts'>
          <DataTable
            columns={accountColumns}
            rows={accounts.data}
            rowKey={r => r.id}
            loading={accounts.isLoading}
            error={accounts.error}
            dense
            toolbar={
              <Can permission='config:write'>
                <CreateAccount types={types.data ?? []} />
              </Can>
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default P2P

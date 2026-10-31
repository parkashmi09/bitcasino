'use client'

import { useState } from 'react'

import Link from 'next/link'

import { PlusIcon, RefreshCwIcon } from 'lucide-react'

import Can from '@/components/shared/Can'
import DataTable, { type Column } from '@/components/shared/DataTable'
import DateTime from '@/components/shared/DateTime'
import FormDialog from '@/components/shared/FormDialog'
import { TextField } from '@/components/shared/FormField'
import Money from '@/components/shared/Money'
import PageHeader from '@/components/shared/PageHeader'
import { useRewardCurrency } from '@/components/shared/RewardCurrency'
import StatusBadge from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApi, useApiMutation, useListState, usePagedApi } from '@/hooks/use-api'
import { api } from '@/lib/api/client'
import { check } from '@/lib/validate'
import { CODE_STATUSES, type BonusUserId, type RedeemCode } from './types'

const generateCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''

  for (let i = 0; i < 10; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]

  return `RC-${s}`
}

const columnsFor = (cur: string): Column<RedeemCode>[] => [
  { key: 'code', header: 'Code', cell: r => <span className='font-mono text-sm font-medium'>{r.code}</span> },
  {
    key: 'user',
    header: 'User',
    cell: r => (
      <Link href={`/users/${r.userId}`} className='font-mono text-xs hover:underline'>
        #{String(r.userId)}
      </Link>
    )
  },
  {
    key: 'amount',
    header: 'Value',
    align: 'right',
    cell: r => (r.kind === 'percentage' ? <span className='font-mono tabular-nums'>{r.bonusPct}% of deposit</span> : <Money value={r.amount} currency={cur} />)
  },
  { key: 'kind', header: 'Kind', cell: r => <Badge variant='outline' className='capitalize'>{r.kind}</Badge> },
  { key: 'status', header: 'Status', cell: r => <StatusBadge value={r.status} /> },
  { key: 'source', header: 'Source', cell: r => <span className='text-muted-foreground text-sm'>{r.source ?? '—'}</span> },
  { key: 'at', header: 'Created', cell: r => <DateTime value={r.createdAt} /> }
]

const CreateCode = () => {
  const { code: cur } = useRewardCurrency()
  const [form, setForm] = useState({ userId: '', code: generateCode(), amount: '' })
  const users = useApi<BonusUserId[]>('admin/user/bonus/users', { channel: 'direct', limit: 200 })

  const create = useApiMutation({
    fn: () => api.post('admin/user/bonus/codes', { userId: Number(form.userId), code: form.code.trim().toUpperCase(), amount: form.amount }),
    invalidate: [['paged', 'admin/user/bonus/codes']],
    success: 'Code issued',
    onSuccess: () => setForm({ userId: '', code: generateCode(), amount: '' })
  })

  return (
    <FormDialog
      trigger={
        <Button>
          <PlusIcon /> Issue code
        </Button>
      }
      title='Issue a redeem code'
      description='A fixed-amount code for one user. It pays out when they redeem it, in the site’s reward currency. Nothing moves now.'
      submitLabel='Issue'
      onSubmit={() => create.mutateAsync()}
      validate={() => ({
        'rc-uid': check.id(form.userId, 'User id'),
        'rc-code': check.required(form.code, 'Code') || check.length(form.code, 'Code', { min: 4, max: 40 }) || (/^[A-Za-z0-9-]+$/.test(form.code.trim()) ? undefined : 'Code may only contain letters, digits and dashes'),
        'rc-amt': check.amount(form.amount)
      })}
    >
      <TextField
        id='rc-uid'
        label='User id'
        required
        inputMode='numeric'
        list='rc-users'
        hint={users.data?.length ? 'Users with a bonus record are suggested; any user id works.' : undefined}
        value={form.userId}
        onChange={e => setForm({ ...form, userId: e.target.value.replace(/\D/g, '') })}
      />
      <datalist id='rc-users'>
        {(users.data ?? []).map(u => (
          <option key={String(u.userid)} value={String(u.userid)}>
            {u.name ?? ''}
          </option>
        ))}
      </datalist>
      <div className='flex items-end gap-2'>
        <div className='grow'>
          <TextField id='rc-code' label='Code' required minLength={4} maxLength={40} pattern='[A-Za-z0-9-]+' hint='Letters, digits and dashes. Stored upper-case.' value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} />
        </div>
        <Button type='button' variant='outline' size='icon' aria-label='Regenerate' className='mb-6' onClick={() => setForm({ ...form, code: generateCode() })}>
          <RefreshCwIcon />
        </Button>
      </div>
      <TextField id='rc-amt' label='Amount' required placeholder='25.00' hint={`Decimal string, in ${cur} (the reward currency).`} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
    </FormDialog>
  )
}

const RedeemCodes = () => {
  const { state, set, query } = useListState(['status', 'userId'], { status: 'all' })
  const { code: cur } = useRewardCurrency()

  const list = usePagedApi<RedeemCode>('admin/user/bonus/codes', {
    // Agent ke users ye use nahi kar sakte — sirf direct users.
    channel: 'direct',
    limit: query.limit,
    page: query.page,
    status: state.status && state.status !== 'all' ? state.status : undefined,
    userId: state.userId || undefined
  })

  return (
    <div>
      <PageHeader
        title='Redeem codes'
        description='Codes issued to users by staff or minted by the spin wheel. A code is single-use; the platform marks it redeemed, expired or superseded — there is no manual disable.'
        actions={
          <Can permission='config:write'>
            <CreateCode />
          </Can>
        }
      />
      <DataTable
        columns={columnsFor(cur)}
        rows={list.data?.rows}
        rowKey={r => r.id}
        loading={list.isLoading}
        fetching={list.isFetching}
        error={list.error}
        pagination={list.data?.pagination}
        onPageChange={page => set({ page })}
        onLimitChange={limit => set({ limit })}
        emptyMessage='No codes issued yet.'
        toolbar={
          <>
            <Input className='w-40' placeholder='User id' inputMode='numeric' value={String(state.userId ?? '')} onChange={e => set({ userId: e.target.value.replace(/\D/g, '') })} />
            <Select value={String(state.status || 'all')} onValueChange={v => v && set({ status: v })}>
              <SelectTrigger className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All statuses</SelectItem>
                {CODE_STATUSES.map(s => (
                  <SelectItem key={s} value={s} className='capitalize'>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
    </div>
  )
}

export default RedeemCodes
